import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import {
  timingSafeEqual,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import https from 'node:https';
import os from 'os';

dotenv.config({ quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 18089;

function readEnv(
  name: string,
  fallback: string
): { value: string; fromEnv: boolean } {
  const raw = process.env[name];
  if (typeof raw === 'string' && raw.trim().length > 0)
    return { value: raw, fromEnv: true };
  if (!IS_PRODUCTION) {
    console.warn(
      `[config] ${name} is not set — using a development-only fallback. This is NOT safe outside local development.`
    );
  }
  return { value: fallback, fromEnv: false };
}

const jwtSecretRaw = readEnv(
  'JWT_SECRET',
  IS_PRODUCTION ? randomBytes(48).toString('base64url') : 'fallback-secret-for-dev'
);
const JWT_SECRET = jwtSecretRaw.value;

const adminUsernameRaw = readEnv('ADMIN_USERNAME', 'admin');
const adminPasswordRaw = readEnv('ADMIN_PASSWORD', 'admin');
const ADMIN_USERNAME = adminUsernameRaw.value;
const ADMIN_PASSWORD = adminPasswordRaw.value;
if (
  IS_PRODUCTION &&
  (!jwtSecretRaw.fromEnv ||
    !adminUsernameRaw.fromEnv ||
    !adminPasswordRaw.fromEnv ||
    ADMIN_USERNAME === 'admin' ||
    ADMIN_PASSWORD === 'admin' ||
    ADMIN_PASSWORD.length < 12)
) {
  throw new Error(
    'Production requires a configured JWT_SECRET and non-default ADMIN_USERNAME / ADMIN_PASSWORD (at least 12 characters).'
  );
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID?.trim() || '';
const TELEGRAM_CONFIGURED = TELEGRAM_BOT_TOKEN.length > 0 && TELEGRAM_OWNER_CHAT_ID.length > 0;

const DB_PATH = process.env.DB_PATH?.trim() || (process.env.VERCEL
  ? '/tmp/amde-jewellery.db'
  : path.join(process.cwd(), 'data', 'amde-jewellery.db'));
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const startupWarnings: string[] = [];
if (ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'admin') {
  startupWarnings.push(
    'the admin panel uses the default admin/admin credentials. Set ADMIN_USERNAME and ADMIN_PASSWORD in your hosting dashboard.'
  );
} else if (!adminUsernameRaw.fromEnv || !adminPasswordRaw.fromEnv) {
  startupWarnings.push(
    'only one of ADMIN_USERNAME / ADMIN_PASSWORD is set; the other falls back to "admin".'
  );
}
if (ADMIN_PASSWORD.length < 8) {
  startupWarnings.push(`ADMIN_PASSWORD is only ${ADMIN_PASSWORD.length} characters long.`);
}
if (!TELEGRAM_CONFIGURED) {
  startupWarnings.push(
    'Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_OWNER_CHAT_ID). Customer inquiries will still be saved; Telegram delivery will be recorded as failed.'
  );
}
if (startupWarnings.length > 0) {
  console.warn(
    `[config] ${startupWarnings.length} configuration note(s):\n${startupWarnings.map((w) => `  - ${w}`).join('\n')}`
  );
} else {
  console.log('[config] all settings configured from the environment.');
}
// ============================================================================
// Password hashing (scrypt, built-in Node crypto — no extra dependency)
// Stored as: scrypt$<base64 salt>$<base64 hash>
// ============================================================================
const SCRYPT_COST = 1 << 14;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_COST });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const hash = Buffer.from(parts[2], 'base64');
  if (!salt || !hash || salt.length !== 16 || hash.length !== 64) return false;
  const computed = scryptSync(password, salt, 64, { N: SCRYPT_COST });
  return timingSafeEqual(hash, computed);
}

// ============================================================================
// SQLite database (better-sqlite3). All SQL values are bound parameters.
const transactionClient = new AsyncLocalStorage<any>();

function normalizeRows<T>(rows: T[]): T[] {
  return rows.map((row) => {
    const normalized = { ...(row as Record<string, unknown>) };
    for (const key of ['c', 'product_count']) {
      if (typeof normalized[key] === 'string') normalized[key] = Number(normalized[key]);
    }
    return normalized as T;
  });
}

const db = {
  prepare(sql: string) {
    const stmt = sqlite.prepare(sql);
    return {
      get<T = Record<string, unknown>>(...args: unknown[]): T | undefined {
        const a = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const row = stmt.get(...(a as any[]));
        return row ? (normalizeRows([row as any])[0] as T) : undefined;
      },
      all<T = Record<string, unknown>>(...args: unknown[]): T[] {
        const a = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return normalizeRows(stmt.all(...(a as any[])) as T[]);
      },
      run(...args: unknown[]) {
        const a = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return stmt.run(...(a as any[]));
      },
    };
  },
  transaction<T>(work: () => Promise<T> | T) {
    return async (): Promise<T> => {
      sqlite.exec('BEGIN');
      try {
        const result = await work();
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    };
  },
};

async function execMigration(sql: string): Promise<void> {
  sqlite.exec(sql);
}

async function ensureColumn(tableName: string, columnName: string, definition: string): Promise<void> {
  const cols = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === columnName)) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function initializeDatabase(): Promise<void> {
  await db.transaction(async () => {
    
await execMigration(`
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS business_profile (
  id TEXT PRIMARY KEY DEFAULT 'single',
  name TEXT NOT NULL DEFAULT 'AMDE JEWELLERY',
  tagline TEXT NOT NULL DEFAULT 'Timeless Elegance. Beautifully Crafted.',
  introduction TEXT NOT NULL DEFAULT 'Discover the beauty of timeless elegance at AMDE JEWELLERY. Explore our exclusive gold and silver jewellery collections.',
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Gold & Silver Jewellery',
  location TEXT,
  address TEXT,
  opening_hours TEXT,
  logo TEXT,
  images TEXT,
  contact_email TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  footer_content TEXT,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS theme_settings (
  id TEXT PRIMARY KEY DEFAULT 'single',
  default_theme TEXT NOT NULL DEFAULT 'creamy-golden',
  gb_background TEXT NOT NULL DEFAULT '#0B0B0B',
  gb_surface TEXT NOT NULL DEFAULT '#171717',
  gb_surface_secondary TEXT NOT NULL DEFAULT '#1C1B19',
  gb_primary_gold TEXT NOT NULL DEFAULT '#D4AF37',
  gb_secondary_gold TEXT NOT NULL DEFAULT '#C6A15B',
  gb_primary_text TEXT NOT NULL DEFAULT '#F5F0E6',
  gb_muted_text TEXT NOT NULL DEFAULT '#AFA99C',
  cg_background TEXT NOT NULL DEFAULT '#FCFAF5',
  cg_surface TEXT NOT NULL DEFAULT '#F4EFE4',
  cg_surface_secondary TEXT NOT NULL DEFAULT '#FFFFFF',
  cg_primary_gold TEXT NOT NULL DEFAULT '#B99548',
  cg_secondary_gold TEXT NOT NULL DEFAULT '#D7C29A',
  cg_primary_text TEXT NOT NULL DEFAULT '#251F18',
  cg_muted_text TEXT NOT NULL DEFAULT '#81776A',
  heading_font TEXT NOT NULL DEFAULT 'Cormorant Garamond',
  body_font TEXT NOT NULL DEFAULT 'Montserrat',
  button_style TEXT NOT NULL DEFAULT 'rounded-full',
  border_radius TEXT NOT NULL DEFAULT '1rem',
  shadow TEXT NOT NULL DEFAULT 'soft',
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS profile_sections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT,
  image TEXT,
  section_type TEXT NOT NULL DEFAULT 'content',
  visible INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS contact_links (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'phone',
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  enabled INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL DEFAULT 0
);
`);

await execMigration(`
CREATE TABLE IF NOT EXISTS jewellery_categories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jewellery_products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  material TEXT,
  price TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  reference TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL DEFAULT 0,
  profile_card INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES jewellery_products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_inquiries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  reference TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  telegram_delivery_status TEXT NOT NULL DEFAULT 'pending',
  telegram_message_id TEXT,
  telegram_delivered_at TEXT,
  telegram_error TEXT,
  telegram_retry_count INTEGER NOT NULL DEFAULT 0,
  internal_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS customer_orders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  reference TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_location TEXT,
  notes TEXT,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS customer_order_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES jewellery_products(id),
  product_name TEXT NOT NULL,
  material TEXT,
  price_snapshot TEXT,
  quantity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS saved_notebook (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('profile', 'product')),
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS footer_settings (
  id TEXT PRIMARY KEY DEFAULT 'single',
  footer_logo TEXT,
  copyright TEXT,
  business_description TEXT,
  contact_info TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  additional_links TEXT
);
`);

await ensureColumn('jewellery_categories', 'updated_at', "TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)");
await ensureColumn('jewellery_products', 'profile_card', 'INTEGER NOT NULL DEFAULT 0');
await ensureColumn('jewellery_products', 'updated_at', "TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)");
await ensureColumn('customer_orders', 'internal_notes', 'TEXT');
await ensureColumn('customer_inquiries', 'telegram_error', 'TEXT');

// --- Additive indexes ---
await execMigration(`
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_reference ON customer_inquiries(reference);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_created_at ON customer_inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_status ON customer_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_telegram_status ON customer_inquiries(telegram_delivery_status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_reference ON customer_orders(reference);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_created_at ON customer_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_customer_order_items_order ON customer_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_jewellery_products_category ON jewellery_products(category_id);
CREATE INDEX IF NOT EXISTS idx_jewellery_products_visible ON jewellery_products(visible, order_index);
CREATE INDEX IF NOT EXISTS idx_jewellery_categories_visible ON jewellery_categories(visible, order_index);
CREATE INDEX IF NOT EXISTS idx_contact_links_order ON contact_links(order_index);
CREATE INDEX IF NOT EXISTS idx_saved_notebook_session ON saved_notebook(session_id, item_type);
`);
  })();


  const seed = db.transaction(async () => {
  
  const adminExists = await db.prepare('SELECT 1 FROM admin_users LIMIT 1').get();
  if (!adminExists) {
    await db.prepare(
      'INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)'
    ).run(lowerHexId(), ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD));
    console.log(`[seed] created admin user "${ADMIN_USERNAME}"`);
  }

  if (!await db.prepare('SELECT 1 FROM business_profile LIMIT 1').get()) {
    await db.prepare(
      `INSERT INTO business_profile (id, name, tagline, introduction, description, category, location, address, contact_email)
       VALUES ('single', 'AMDE JEWELLERY', 'Timeless Elegance. Beautifully Crafted.',
        'Discover the beauty of timeless elegance at AMDE JEWELLERY. Explore our exclusive gold and silver jewellery collections.',
        'AMDE JEWELLERY is a premium luxury boutique specialising in handcrafted gold and silver jewellery.',
        'Gold & Silver Jewellery', 'Addis Ababa, Ethiopia', 'Addis Ababa, Ethiopia', 'info@amdejewellery.example')`
    ).run();
    console.log('[seed] created default business profile');
  }

  if (!await db.prepare('SELECT 1 FROM theme_settings LIMIT 1').get()) {
    await db.prepare("INSERT INTO theme_settings (id) VALUES ('single')").run();
    console.log('[seed] created default theme settings');
  }

  const sectionsCount = await db.prepare('SELECT COUNT(*) AS c FROM profile_sections').get() as { c: number };
  if (sectionsCount.c === 0) {
    const now = new Date().toISOString();
    const sectionIds = ['s-profile', 's-actions', 's-collection', 's-footer'];
    const titles = ['Profile', 'Contact Actions', 'Jewellery Collection', 'Footer'];
    for (let i = 0; i < sectionIds.length; i++) {
      await db.prepare(
        'INSERT INTO profile_sections (id, title, section_type, visible, order_index, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(sectionIds[i], titles[i], 'content', 1, i, now);
    }
    console.log('[seed] created default profile sections');
  }

  if ((await db.prepare('SELECT COUNT(*) AS c FROM contact_links').get() as { c: number }).c === 0) {
    const now = new Date().toISOString();
    const defaultLinks = [
      ['Call', 'phone', 'tel:', 'phone', 0],
      ['WhatsApp', 'message-circle', 'https://wa.me/', 'whatsapp', 1],
      ['Telegram', 'send', 'https://t.me/', 'telegram', 2],
      ['Instagram', 'instagram', 'https://instagram.com/', 'instagram', 3],
      ['Facebook', 'facebook', 'https://facebook.com/', 'facebook', 4],
      ['TikTok', 'tiktok', 'https://tiktok.com/', 'tiktok', 5],
      ['Location', 'map-pin', 'https://maps.google.com/', 'location', 6],
    ];
    for (const [label, icon, url, type, order] of defaultLinks) {
      await db.prepare(
        'INSERT INTO contact_links (label, icon, url, type, enabled, order_index) VALUES (?, ?, ?, ?, 1, ?)'
      ).run(label, icon, url, type, order);
    }
    console.log('[seed] created default contact links');
  }

  if ((await db.prepare('SELECT COUNT(*) AS c FROM jewellery_categories').get() as { c: number }).c === 0) {
    const now = new Date().toISOString();
    const categories = [
      ['Gold Jewellery', 'gold-jewellery', 'Exquisite gold jewellery pieces for every occasion.', 1, 0],
      ['Silver Jewellery', 'silver-jewellery', 'Timeless silver designs crafted with care.', 1, 1],
      ['Gold Rings', 'gold-rings', 'Handcrafted gold rings, from bands to statement pieces.', 0, 2],
      ['Silver Rings', 'silver-rings', 'Elegant silver rings for daily wear and celebrations.', 0, 3],
      ['Gold Necklaces', 'gold-necklaces', 'Luxurious gold necklaces and chains.', 0, 4],
      ['Silver Necklaces', 'silver-necklaces', 'Refined silver necklaces and pendants.', 0, 5],
      ['Bracelets', 'bracelets', 'Gold and silver bracelets for every wrist.', 0, 6],
      ['Earrings', 'earrings', 'Delicate and bold gold and silver earrings.', 0, 7],
      ['Traditional Jewellery', 'traditional-jewellery', 'Heritage pieces inspired by timeless traditions.', 0, 8],
      ['New Arrivals', 'new-arrivals', 'The latest additions to the AMDE JEWELLERY collection.', 1, 9],
      ['Featured Collection', 'featured-collection', 'Our most-loved signature pieces.', 1, 10],
    ];
    for (const [name, slug, description, featured, order] of categories) {
      await db.prepare(
        `INSERT INTO jewellery_categories (id, name, slug, description, featured, order_index, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(lowerHexId(), name, slug, description, featured, order, now);
    }
    console.log('[seed] created default jewellery categories');
  }

  const productsCount = await db.prepare('SELECT COUNT(*) AS c FROM jewellery_products').get() as { c: number };
  if (productsCount.c === 0) {
    console.log('[seed] no products found — add products via the admin dashboard');
  }

  if (!await db.prepare('SELECT 1 FROM footer_settings LIMIT 1').get()) {
    await db.prepare(
      `INSERT INTO footer_settings (id, copyright, business_description, visible)
       VALUES ('single', '© 2026 AMDE JEWELLERY. All rights reserved.', 'Premium luxury gold and silver jewellery boutique.', 1)`
    ).run();
    console.log('[seed] created default footer settings');
  }
});
await seed();


}

await initializeDatabase();
// ============================================================================
// Helpers
// ============================================================================
function lowerHexId(): string {
  return randomBytes(16).toString('hex');
}

function generateReference(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}-${Date.now().toString(36)}`;
}

function isValidOptionalImage(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || value.length > 10_000_000) return false;
  return (
    value.startsWith('data:image/') ||
    value.startsWith('/') ||
    value.startsWith('http://') ||
    value.startsWith('https://')
  );
}

function parseOptionalImage(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  return isValidOptionalImage(value) ? value : null;
}

function parsePublicLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return /^(https?:\/\/|tel:|mailto:|geo:)/i.test(url) ? url : null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

function setAuthCookie(res: express.Response, token: string): void {
  const secure = IS_PRODUCTION ? ' Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=86400`
  );
}

function clearAuthCookie(res: express.Response): void {
  const secure = IS_PRODUCTION ? ' Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `admin_token=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

// ============================================================================
// Authentication
// ============================================================================
const authenticateAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const tokenFromCookie = cookies.admin_token;
  const authHeader = req.headers.authorization;
  const tokenFromHeader =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const token = tokenFromCookie || tokenFromHeader;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as {
      username: string;
      role: string;
    };
    (req as any).user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ============================================================================
// Rate limiting (in-memory, per IP — no extra dependencies)
// ============================================================================
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const createRateLimiter = (windowMs: number, maxAttempts: number) => {
  const failures = new Map<string, RateLimitEntry>();
  const prune = (now: number) => {
    for (const [ip, entry] of failures) {
      if (now - entry.windowStart > windowMs) failures.delete(ip);
    }
  };
  return {
    isBlocked: (ip: string): boolean => {
      const now = Date.now();
      prune(now);
      const entry = failures.get(ip);
      if (!entry) return false;
      if (now - entry.windowStart > windowMs) {
        failures.delete(ip);
        return false;
      }
      return entry.count >= maxAttempts;
    },
    recordFailure: (ip: string) => {
      const now = Date.now();
      const entry = failures.get(ip);
      if (!entry || now - entry.windowStart > windowMs) {
        failures.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count += 1;
      }
      if (failures.size > 1000) prune(now);
    },
    clear: (ip: string) => failures.delete(ip),
  };
};

const loginLimiter = createRateLimiter(15 * 60 * 1000, 10);
const contactLimiter = createRateLimiter(10 * 60 * 1000, 5);
const orderLimiter = createRateLimiter(15 * 60 * 1000, 10);

// ============================================================================
// Telegram notifications (backend only — token never reaches the client)
// ============================================================================
function sendTelegramMessage(text: string): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  if (!TELEGRAM_CONFIGURED) {
    return Promise.resolve({ ok: false, error: 'Telegram is not configured on the server' });
  }
  const payload = JSON.stringify({
    chat_id: TELEGRAM_OWNER_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  return new Promise((resolve) => {
    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (parsed.ok) {
              resolve({ ok: true, messageId: parsed.result?.message_id });
            } else {
              resolve({ ok: false, error: parsed.description || 'Telegram API error' });
            }
          } catch (err) {
            resolve({ ok: false, error: 'Invalid Telegram API response' });
          }
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
    req.write(payload);
    req.end();
  });
}

function formatInquiryTelegramMessage(inquiry: {
  reference: string;
  customerName: string;
  phoneNumber: string;
  email: string | null;
  message: string;
  createdAt: string;
}): string {
  const submitted = new Date(inquiry.createdAt).toLocaleString('en-GB', {
    timeZone: 'Africa/Addis_Ababa',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [
    '🔔 <b>NEW CUSTOMER MESSAGE</b>',
    '',
    '<b>AMDE JEWELLERY</b>',
    '',
    `👤 <b>Customer Name:</b>\n${escapeHtml(inquiry.customerName)}`,
    '',
    `📞 <b>Phone Number:</b>\n${escapeHtml(inquiry.phoneNumber)}`,
    '',
    `📧 <b>Email Address:</b>\n${escapeHtml(inquiry.email ?? 'Not Provided')}`,
    '',
    `💬 <b>CUSTOMER MESSAGE:</b>\n${escapeHtml(inquiry.message)}`,
    '',
    `🆔 <b>Inquiry Reference:</b>\n${escapeHtml(inquiry.reference)}`,
    '',
    `📅 <b>Submitted:</b>\n${submitted}`,
    '',
    '📌 <b>Status:</b> NEW',
  ].join('\n');
}

async function attemptTelegramDelivery(inquiryId: string, text: string): Promise<{
  status: 'sent' | 'failed';
  messageId: string | null;
  deliveredAt: string | null;
  error: string | null;
}> {
  const result = await sendTelegramMessage(text);
  const now = new Date().toISOString();
  if (result.ok) {
    await db.prepare(
      `UPDATE customer_inquiries
       SET telegram_delivery_status = 'sent', telegram_message_id = ?, telegram_delivered_at = ?, telegram_error = NULL, updated_at = ?
       WHERE id = ?`
    ).run(result.messageId?.toString() ?? null, now, now, inquiryId);
    return { status: 'sent', messageId: result.messageId?.toString() ?? null, deliveredAt: now, error: null };
  }
  await db.prepare(
    `UPDATE customer_inquiries
     SET telegram_delivery_status = 'failed', telegram_error = ?, telegram_retry_count = telegram_retry_count + 1, updated_at = ?
     WHERE id = ?`
  ).run(result.error ?? 'Unknown error', now, inquiryId);
  return { status: 'failed', messageId: null, deliveredAt: null, error: result.error ?? 'Unknown error' };
}

// ============================================================================
// Express application
// ============================================================================
async function createApp() {
  const app = express();
  const asyncRoute = (handler: express.RequestHandler): express.RequestHandler =>
    (req, res, next) => {
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  const routes = {
    get: (path: string, ...handlers: express.RequestHandler[]) =>
      app.get(path, ...handlers.map(asyncRoute)),
    post: (path: string, ...handlers: express.RequestHandler[]) =>
      app.post(path, ...handlers.map(asyncRoute)),
    put: (path: string, ...handlers: express.RequestHandler[]) =>
      app.put(path, ...handlers.map(asyncRoute)),
    delete: (path: string, ...handlers: express.RequestHandler[]) =>
      app.delete(path, ...handlers.map(asyncRoute)),
  };

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '12mb' }));
  app.set('trust proxy', 1);

  routes.get('/api/health', async (_req, res) => {
    try {
      await db.prepare('SELECT 1').get();
    } catch (error) {
      console.error('Database health check failed:', error);
      return res.status(503).json({ status: 'unavailable', error: 'Database unavailable' });
    }
    res.json({
      status: 'ok',
      database: 'postgresql',
      environment: NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      telegramConfigured: TELEGRAM_CONFIGURED,
    });
  });

  routes.get('/api/business-profile', async (_req, res) => {
    try {
      const row = await db.prepare("SELECT * FROM business_profile WHERE id = 'single'")
        .get() as { opening_hours: string | null; images: string | null; [key: string]: unknown } | undefined;
      if (!row) return res.status(404).json({ error: 'Business profile not found' });
      if (!row.visible) return res.status(404).json({ error: 'Business profile is unavailable' });
      res.json({
        ...row,
        opening_hours: parseJson(row.opening_hours, {}),
        images: parseJson(row.images, []),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load business profile' });
    }
  });

  routes.get('/api/theme-settings', async (_req, res) => {
    try {
      const row = await db.prepare("SELECT * FROM theme_settings WHERE id = 'single'").get();
      if (!row) return res.status(404).json({ error: 'Theme settings not found' });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load theme settings' });
    }
  });

  routes.get('/api/profile-sections', async (_req, res) => {
    try {
      const rows = await db.prepare(
          'SELECT id, title, description, section_type, visible, order_index FROM profile_sections ORDER BY order_index ASC, id ASC'
        )
        .all() as { image: string | null }[];
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load profile sections' });
    }
  });

  routes.get('/api/contact-links', async (_req, res) => {
    try {
      const rows = await db.prepare('SELECT * FROM contact_links ORDER BY order_index ASC, id ASC')
        .all() as { url: string | null }[];
      res.json(rows.map((row) => ({ ...row, url: parsePublicLink(row.url) })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load contact links' });
    }
  });

  routes.get('/api/footer-settings', async (_req, res) => {
    try {
      const row = await db.prepare("SELECT * FROM footer_settings WHERE id = 'single'")
        .get() as { additional_links: string | null; [key: string]: unknown } | undefined;
      if (!row) return res.status(404).json({ error: 'Footer settings not found' });
      res.json({ ...row, additional_links: parseJson(row.additional_links, []) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load footer settings' });
    }
  });

  routes.get('/api/categories', async (_req, res) => {
    try {
      const rows = await db.prepare(
          'SELECT * FROM jewellery_categories WHERE visible = 1 ORDER BY order_index ASC, id ASC'
        )
        .all() as { image: string | null }[];
      res.json(rows.map((row) => ({ ...row, image: parseOptionalImage(row.image) })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load categories' });
    }
  });

  routes.get('/api/products', async (req, res) => {
    try {
      const category =
        typeof req.query.category === 'string' ? req.query.category : undefined;
      const featured = req.query.featured === '1' || req.query.featured === 'true';
      const profileCards = req.query.profileCards === '1' || req.query.profileCards === 'true';
      let sql =
        'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM jewellery_products p JOIN jewellery_categories c ON c.id = p.category_id WHERE p.visible = 1';
      const params: unknown[] = [];
      if (category) {
        sql += ' AND c.slug = ?';
        params.push(category);
      }
      if (featured) {
        sql += ' AND p.featured = 1';
      }
      if (profileCards) {
        sql += ' AND p.profile_card = 1';
      }
      sql += profileCards
        ? ' ORDER BY p.order_index ASC, p.created_at DESC'
        : ' ORDER BY p.featured DESC, p.order_index ASC, p.created_at DESC';
      if (profileCards) {
        sql += ' LIMIT 5';
      }
      const products = await db.prepare(sql).all(params) as {
        images: string | null;
        [key: string]: unknown;
      }[];
      const productIds = products.map((p) => p.id);
      let imagesByProduct: Record<string, { id: string; url: string; orderIndex: number }[]> = {};
      if (productIds.length > 0) {
        const placeholders = productIds.map(() => '?').join(',');
        const rows = await db.prepare(
            `SELECT product_id, url, order_index, id FROM product_images WHERE product_id IN (${placeholders}) ORDER BY order_index ASC, id ASC`
          )
          .all(productIds) as { product_id: string; url: string; order_index: number; id: string }[];
        for (const row of rows) {
          if (!imagesByProduct[row.product_id]) imagesByProduct[row.product_id] = [];
          imagesByProduct[row.product_id].push({
            id: row.id,
            url: parseOptionalImage(row.url),
            orderIndex: row.order_index,
          });
        }
      }
      res.json(
        products.map((p) => ({
          ...p,
          images: imagesByProduct[p.id as string] || [],
        }))
      );
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load products' });
    }
  });

  routes.get('/api/notebook', async (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    if (!/^[a-f0-9]{32,64}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid notebook session is required.' });
    }

    try {
      const rows = await db.prepare(
          `SELECT item_type AS itemType, reference_id AS referenceId FROM saved_notebook
           WHERE session_id = ?
           ORDER BY created_at DESC`
        )
        .all(sessionId);
      res.json(rows);
    } catch (error) {
      console.error('Failed to load notebook:', error);
      res.status(500).json({ error: 'Failed to load notebook.' });
    }
  });

  routes.delete('/api/notebook', async (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    if (!/^[a-f0-9]{32,64}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid notebook session is required.' });
    }
    try {
      await db.prepare('DELETE FROM saved_notebook WHERE session_id = ?').run(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to clear notebook:', error);
      res.status(500).json({ error: 'Failed to clear your notebook.' });
    }
  });

  routes.post('/api/notebook', async (req, res) => {
    const { sessionId, itemType = 'product', referenceId, productId } = req.body ?? {};
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{32,64}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid notebook session is required.' });
    }
    const itemId = referenceId ?? productId;
    if (!['profile', 'product'].includes(itemType) || typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 100) {
      return res.status(400).json({ error: 'A valid jewellery item is required.' });
    }

    try {
      if (itemType === 'product') {
        const product = await db.prepare('SELECT 1 FROM jewellery_products WHERE id = ? AND visible = 1')
          .get(itemId);
        if (!product) {
          return res.status(404).json({ error: 'Jewellery item not found.' });
        }
      } else if (itemId !== 'single') {
        return res.status(400).json({ error: 'Invalid business profile reference.' });
      }

      await db.prepare(
        `INSERT INTO saved_notebook (id, session_id, item_type, reference_id)
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM saved_notebook
           WHERE session_id = ? AND item_type = ? AND reference_id = ?
         )`
      ).run(lowerHexId(), sessionId, itemType, itemId, sessionId, itemType, itemId);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save notebook item:', error);
      res.status(500).json({ error: 'Failed to save jewellery item to notebook.' });
    }
  });

  routes.delete('/api/notebook/:itemType/:referenceId', async (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const { itemType, referenceId } = req.params;
    if (!/^[a-f0-9]{32,64}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid notebook session is required.' });
    }
    if (!['profile', 'product'].includes(itemType) || referenceId.length === 0 || referenceId.length > 100) {
      return res.status(400).json({ error: 'A valid jewellery item is required.' });
    }

    try {
      await db.prepare(
        `DELETE FROM saved_notebook
         WHERE session_id = ? AND item_type = ? AND reference_id = ?`
      ).run(sessionId, itemType, referenceId);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to remove notebook item:', error);
      res.status(500).json({ error: 'Failed to remove jewellery item from notebook.' });
    }
  });

  routes.delete('/api/notebook/:productId', async (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const productId = req.params.productId;
    if (!/^[a-f0-9]{32,64}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid notebook session is required.' });
    }
    try {
      await db.prepare(
        `DELETE FROM saved_notebook
         WHERE session_id = ? AND item_type = 'product' AND reference_id = ?`
      ).run(sessionId, productId);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to remove notebook item:', error);
      res.status(500).json({ error: 'Failed to remove jewellery item from notebook.' });
    }
  });

  routes.get('/api/products/:id', async (req, res) => {
    try {
      const product = await db.prepare(
          'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM jewellery_products p JOIN jewellery_categories c ON c.id = p.category_id WHERE p.id = ? AND p.visible = 1'
        )
        .get(req.params.id) as { images: string | null; [key: string]: unknown } | undefined;
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const rows = await db.prepare(
          'SELECT id, url, order_index FROM product_images WHERE product_id = ? ORDER BY order_index ASC, id ASC'
        )
        .all(product.id) as { url: string | null; order_index: number; id: string }[];
      res.json({
        ...product,
        images: rows.map((row) => ({
          id: row.id,
          url: parseOptionalImage(row.url),
          orderIndex: row.order_index,
        })),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load product' });
    }
  });

  // ============================================================================
  // Customer messages — POST /api/contact/telegram
  // ============================================================================
  routes.post('/api/contact/telegram', async (req, res) => {
    const clientIp = req.ip || 'unknown';
    if (contactLimiter.isBlocked(clientIp)) {
      return res.status(429).json({
        error: 'Too many message submissions. Please wait a little while before trying again.',
      });
    }

    const { customerName, phoneNumber, email, message, website } = req.body ?? {};

    if (typeof website === 'string' && website.trim()) {
      return res.status(400).json({ error: 'Message could not be submitted.' });
    }

    const errors: Record<string, string> = {};

    if (typeof customerName !== 'string' || customerName.trim().length === 0) {
      errors.customerName = 'Customer name is required.';
    } else if (customerName.trim().length > 100) {
      errors.customerName = 'Name must be 100 characters or fewer.';
    }

    if (typeof phoneNumber !== 'string' || phoneNumber.trim().length === 0) {
      errors.phoneNumber = 'Phone number is required.';
    } else {
      const phone = phoneNumber.trim();
      const digits = phone.replace(/[^0-9+]/g, '');
      const digitCount = digits.replace(/\+/g, '').length;
      if (!/^\+?[0-9][0-9 ]{5,}$/.test(phone) || digitCount < 6 || digitCount > 20) {
        errors.phoneNumber = 'Please enter a valid phone number.';
      }
    }

    if (email !== undefined && email !== null && email !== '') {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        errors.email = 'Please enter a valid email address.';
      } else if (email.trim().length > 200) {
        errors.email = 'Email must be 200 characters or fewer.';
      }
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
      errors.message = 'Please write your message.';
    } else {
      const trimmed = message.trim();
      if (trimmed.length < 5) {
        errors.message = 'Message is too short (minimum 5 characters).';
      } else if (trimmed.length > 2000) {
        errors.message = 'Message is too long (maximum 2,000 characters).';
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    contactLimiter.recordFailure(clientIp);

    const now = new Date().toISOString();
    const reference = generateReference('AMDE');
    const inquiryId = lowerHexId();

    await db.prepare(
      `INSERT INTO customer_inquiries (
        id, reference, customer_name, phone_number, email, message, status,
        telegram_delivery_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'new', 'pending', ?, ?)`
    ).run(
      inquiryId,
      reference,
      customerName.trim(),
      phoneNumber.trim(),
      email ? email.trim() || null : null,
      message.trim(),
      now,
      now
    );

    const telegramText = formatInquiryTelegramMessage({
      reference,
      customerName: customerName.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email ? email.trim() : null,
      message: message.trim(),
      createdAt: now,
    });

    await attemptTelegramDelivery(inquiryId, telegramText);

    const finalRow = await db.prepare('SELECT * FROM customer_inquiries WHERE reference = ?')
      .get(reference) as {
        reference: string;
        telegram_delivery_status: string;
        telegram_delivered_at: string | null;
      };

    return res.json({
      success: true,
      reference: finalRow.reference,
      message:
        "Thank you for contacting AMDE JEWELLERY! Your message has been submitted successfully. We'll get back to you soon.",
      telegramDeliveryStatus: finalRow.telegram_delivery_status,
      deliveredAt: finalRow.telegram_delivered_at,
    });
  });

  // ============================================================================
  // Customer orders — My Order inquiry
  // ============================================================================
  routes.post('/api/orders', async (req, res) => {
    const clientIp = req.ip || 'unknown';
    if (orderLimiter.isBlocked(clientIp)) {
      return res.status(429).json({
        error: 'Too many order submissions. Please wait a little while before trying again.',
      });
    }

    const { customerName, phone, deliveryLocation, notes, items } = req.body ?? {};

    const errors: Record<string, string> = {};

    if (typeof customerName !== 'string' || customerName.trim().length === 0) {
      errors.customerName = 'Your name is required.';
    } else if (customerName.trim().length > 100) {
      errors.customerName = 'Name must be 100 characters or fewer.';
    }

    if (typeof phone !== 'string' || phone.trim().length === 0) {
      errors.phone = 'Phone number is required.';
    } else {
      const digits = phone.replace(/[^0-9+]/g, '');
      const digitCount = digits.replace(/\+/g, '').length;
      if (!/^\+?[0-9][0-9 ]{5,}$/.test(phone.trim()) || digitCount < 6 || digitCount > 20) {
        errors.phone = 'Please enter a valid phone number.';
      }
    }

    if (deliveryLocation !== undefined && deliveryLocation !== null && deliveryLocation !== '') {
      if (typeof deliveryLocation !== 'string' || deliveryLocation.trim().length > 300) {
        errors.deliveryLocation = 'Delivery location must be 300 characters or fewer.';
      }
    }

    if (notes !== undefined && notes !== null && notes !== '') {
      if (typeof notes !== 'string' || notes.trim().length > 1000) {
        errors.notes = 'Notes must be 1,000 characters or fewer.';
      }
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      errors.items = 'Please select at least one product.';
    } else {
      let itemIndex = 0;
      for (const item of items) {
        if (!item || typeof item.productId !== 'string' || item.productId.length === 0) {
          errors[`items[${itemIndex}].product`] = 'Invalid product.';
        }
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
          errors[`items[${itemIndex}].quantity`] = 'Quantity must be between 1 and 99.';
        }
        itemIndex += 1;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    const orderProducts = await Promise.all((items as Array<{ productId: string; quantity: number }>).map(async (item) => {
      const product = await db.prepare(
          `SELECT p.name, p.material, p.price, p.available
           FROM jewellery_products p
           WHERE p.id = ? AND p.visible = 1`
        )
        .get(item.productId) as {
          name: string;
          material: string | null;
          price: string | null;
          available: number;
        } | undefined;
      return product?.available ? { ...product, productId: item.productId, quantity: Number(item.quantity) } : null;
    }));
    if (orderProducts.some((item) => item === null)) {
      return res.status(400).json({ error: 'One or more selected jewellery pieces are no longer available.' });
    }

    orderLimiter.recordFailure(clientIp);

    const now = new Date().toISOString();
    const reference = generateReference('ORD');
    const orderId = lowerHexId();
    const status = 'pending';

    const insertOrder = db.prepare(
      `INSERT INTO customer_orders (
        id, reference, customer_name, phone, delivery_location, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertItem = db.prepare(
      `INSERT INTO customer_order_items (
        id, order_id, product_id, product_name, material, price_snapshot, quantity
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertHistory = db.prepare(
      `INSERT INTO order_status_history (id, order_id, status, note, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    const saveOrder = db.transaction(async () => {
      await insertOrder.run(
        orderId,
        reference,
        customerName.trim(),
        phone.trim(),
        deliveryLocation ? deliveryLocation.trim() || null : null,
        notes ? notes.trim() || null : null,
        status,
        now,
        now
      );
      await insertHistory.run(lowerHexId(), orderId, status, 'Order received from customer', now);
      for (const item of orderProducts) {
        if (!item) continue;
        await insertItem.run(
          lowerHexId(),
          orderId,
          item.productId,
          item.name,
          item.material,
          item.price,
          item.quantity
        );
      }
    });

    try {
      await saveOrder();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Failed to save order. Please try again.' });
    }

    const savedOrder = await db.prepare('SELECT * FROM customer_orders WHERE reference = ?').get(reference) as {
      reference: string;
      created_at: string;
    };

    return res.json({
      success: true,
      reference: savedOrder.reference,
      message: 'Your order inquiry has been received. We will contact you shortly to confirm availability and delivery.',
      createdAt: savedOrder.created_at,
    });
  });

  routes.get('/api/orders', async (req, res) => {
    try {
      const reference =
        typeof req.query.reference === 'string' ? req.query.reference : undefined;
      const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
      if (!reference || !phone) {
        return res.status(400).json({ error: 'Order reference and phone number are required.' });
      }
      const order = await db.prepare(
          `SELECT id, reference, customer_name, phone, delivery_location, status, created_at, updated_at
           FROM customer_orders WHERE reference = ? AND phone = ?`
        )
        .get(reference, phone) as { [key: string]: unknown } | undefined;
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      const items = await db.prepare('SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id ASC')
        .all(order.id);
      const history = await db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC')
        .all(order.id);
      res.json({ ...order, items, statusHistory: history });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load order.' });
    }
  });

  // ============================================================================
  // Admin API — all routes require authentication
  // ============================================================================

  routes.post('/api/auth/login', async (req, res) => {
    const clientIp = req.ip || 'unknown';
    if (loginLimiter.isBlocked(clientIp)) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Please try again in a few minutes.',
      });
    }
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await db.prepare('SELECT * FROM admin_users WHERE username = ?')
      .get(username) as { id: string; username: string; password_hash: string } | undefined;

    const valid = user && verifyPassword(password, user.password_hash);
    if (!valid) {
      loginLimiter.recordFailure(clientIp);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginLimiter.clear(clientIp);
    const token = jwt.sign(
      { username: user.username, role: 'admin', sub: user.id },
      JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' }
    );
    setAuthCookie(res, token);
    res.json({ success: true, username: user.username });
  });

  routes.post('/api/auth/logout', async (_req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
  });

  routes.get('/api/admin/me', authenticateAdmin, async (_req, res) => {
    res.json({ username: ADMIN_USERNAME, role: 'admin' });
  });

  routes.get('/api/admin/dashboard', authenticateAdmin, async (_req, res) => {
    try {
      const getCount = async (sql: string, params: unknown[] = []): Promise<number> =>
        (await db.prepare(sql).get(params) as { c: number }).c;

      const totalProducts = await getCount('SELECT COUNT(*) AS c FROM jewellery_products');
      const activeProducts = await getCount(
        'SELECT COUNT(*) AS c FROM jewellery_products WHERE visible = 1'
      );
      const totalCategories = await getCount('SELECT COUNT(*) AS c FROM jewellery_categories');
      const totalOrders = await getCount('SELECT COUNT(*) AS c FROM customer_orders');
      const pendingOrders = await getCount(
        "SELECT COUNT(*) AS c FROM customer_orders WHERE status = 'pending'"
      );
      const confirmedOrders = await getCount(
        "SELECT COUNT(*) AS c FROM customer_orders WHERE status = 'confirmed'"
      );
      const completedOrders = await getCount(
        "SELECT COUNT(*) AS c FROM customer_orders WHERE status = 'completed'"
      );
      const totalInquiries = await getCount('SELECT COUNT(*) AS c FROM customer_inquiries');
      const newMessages = await getCount(
        "SELECT COUNT(*) AS c FROM customer_inquiries WHERE status = 'new'"
      );
      const failedTelegram = await getCount(
        "SELECT COUNT(*) AS c FROM customer_inquiries WHERE telegram_delivery_status = 'failed'"
      );

      const recentOrders = await db.prepare(
          'SELECT reference, customer_name, phone, status, created_at FROM customer_orders ORDER BY created_at DESC LIMIT 5'
        )
        .all();
      const recentInquiries = await db.prepare(
          'SELECT reference, customer_name, phone_number, message, status, telegram_delivery_status, created_at FROM customer_inquiries ORDER BY created_at DESC LIMIT 5'
        )
        .all();

      res.json({
        stats: {
          totalProducts,
          activeProducts,
          totalCategories,
          totalOrders,
          pendingOrders,
          confirmedOrders,
          completedOrders,
          totalInquiries,
          newMessages,
          failedTelegram,
        },
        recentOrders,
        recentInquiries,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load dashboard statistics' });
    }
  });

  // --- Business profile ---
  routes.get('/api/admin/business-profile', authenticateAdmin, async (_req, res) => {
    try {
      const row = await db.prepare("SELECT * FROM business_profile WHERE id = 'single'")
        .get() as {
          opening_hours: string | null;
          images: string | null;
          [key: string]: unknown;
        } | undefined;
      if (!row) return res.status(404).json({ error: 'Business profile not found' });
      res.json({
        ...row,
        opening_hours: parseJson(row.opening_hours, {}),
        images: parseJson(row.images, []),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load business profile' });
    }
  });

  routes.put('/api/admin/business-profile', authenticateAdmin, async (req, res) => {
    try {
      const {
        name,
        tagline,
        introduction,
        description,
        category,
        location,
        address,
        openingHours,
        logo,
        images,
        contactEmail,
        visible,
        footerContent,
      } = req.body ?? {};

      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        return res.status(400).json({ error: 'Business name is required.' });
      }
      if (name !== undefined && name.trim().length > 120) {
        return res.status(400).json({ error: 'Business name must be 120 characters or fewer.' });
      }
      if (tagline !== undefined && tagline.trim().length > 200) {
        return res.status(400).json({ error: 'Tagline must be 200 characters or fewer.' });
      }
      if (contactEmail && typeof contactEmail !== 'string') {
        return res.status(400).json({ error: 'Invalid contact email.' });
      }
      if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
        return res.status(400).json({ error: 'Invalid contact email address.' });
      }
      if (logo !== undefined) {
        const parsed = parseOptionalImage(logo);
        if (parsed === null && logo !== null && logo !== '') {
          return res.status(400).json({ error: 'Invalid logo image.' });
        }
      }
      if (images !== undefined && !Array.isArray(images)) {
        return res.status(400).json({ error: 'Images must be an array.' });
      }
      if (Array.isArray(images) && images.some((image) => !isValidOptionalImage(image))) {
        return res.status(400).json({ error: 'Each image must be a valid image URL or data image.' });
      }

      const now = new Date().toISOString();
      await db.prepare(
        `UPDATE business_profile SET
          name = COALESCE(?, name),
          tagline = COALESCE(?, tagline),
          introduction = COALESCE(?, introduction),
          description = COALESCE(?, description),
          category = COALESCE(?, category),
          location = COALESCE(?, location),
          address = COALESCE(?, address),
          opening_hours = COALESCE(?, opening_hours),
          logo = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, logo) END,
          images = COALESCE(?, images),
          contact_email = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, contact_email) END,
          visible = COALESCE(?, visible),
          footer_content = COALESCE(?, footer_content),
          updated_at = ?
        WHERE id = 'single'`
      ).run(
        name !== undefined ? name.trim() : null,
        tagline !== undefined ? tagline.trim() : null,
        introduction !== undefined ? introduction : null,
        description !== undefined ? description : null,
        category !== undefined ? category.trim() : null,
        location !== undefined ? location.trim() : null,
        address !== undefined ? address.trim() : null,
        openingHours !== undefined ? JSON.stringify(openingHours) : null,
        logo === null || logo === '' ? 1 : 0,
        logo !== undefined ? parseOptionalImage(logo) : null,
        images !== undefined ? JSON.stringify(images) : null,
        contactEmail === '' ? 1 : 0,
        contactEmail !== undefined ? (contactEmail ? contactEmail.trim() : null) : null,
        visible !== undefined ? (visible ? 1 : 0) : null,
        footerContent !== undefined ? footerContent : null,
        now
      );
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save business profile' });
    }
  });

  // --- Theme settings ---
  routes.get('/api/admin/theme-settings', authenticateAdmin, async (_req, res) => {
    try {
      const row = await db.prepare("SELECT * FROM theme_settings WHERE id = 'single'").get();
      if (!row) return res.status(404).json({ error: 'Theme settings not found' });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load theme settings' });
    }
  });

  const THEME_COLUMNS = new Set([
    'default_theme',
    'gb_background',
    'gb_surface',
    'gb_surface_secondary',
    'gb_primary_gold',
    'gb_secondary_gold',
    'gb_primary_text',
    'gb_muted_text',
    'cg_background',
    'cg_surface',
    'cg_surface_secondary',
    'cg_primary_gold',
    'cg_secondary_gold',
    'cg_primary_text',
    'cg_muted_text',
    'heading_font',
    'body_font',
    'button_style',
    'border_radius',
    'shadow',
  ]);

  routes.put('/api/admin/theme-settings', authenticateAdmin, async (req, res) => {
    try {
      const updates: string[] = [];
      const params: unknown[] = [];
      for (const [key, value] of Object.entries(req.body ?? {})) {
        if (!THEME_COLUMNS.has(key)) continue;
        if (typeof value !== 'string' && value !== null) {
          return res.status(400).json({ error: `Invalid value for ${key}` });
        }
        updates.push(`${key} = ?`);
        params.push(value);
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No settings to update' });
      }
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push('single');
      await db.prepare(
        `UPDATE theme_settings SET ${updates.join(', ')} WHERE id = ?`
      ).run(...params);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save theme settings' });
    }
  });

  // --- Contact links ---
  routes.get('/api/admin/contact-links', authenticateAdmin, async (_req, res) => {
    try {
      const rows = await db.prepare('SELECT * FROM contact_links ORDER BY order_index ASC, id ASC')
        .all() as { url: string | null }[];
      res.json(rows.map((row) => ({ ...row, url: parsePublicLink(row.url) })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load contact links' });
    }
  });

  routes.post('/api/admin/contact-links', authenticateAdmin, async (req, res) => {
    try {
      const { label, icon, url, type, enabled, orderIndex } = req.body ?? {};
      if (typeof label !== 'string' || label.trim().length === 0) {
        return res.status(400).json({ error: 'Label is required.' });
      }
      if (typeof url !== 'string' || url.trim().length === 0) {
        return res.status(400).json({ error: 'Destination is required.' });
      }
      if (!parsePublicLink(url)) {
        return res.status(400).json({ error: 'Destination must use http, https, tel, mailto, or geo.' });
      }
      const id = lowerHexId();
      await db.prepare(
        `INSERT INTO contact_links (id, label, icon, url, type, enabled, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        label.trim(),
        icon || 'link',
        url.trim(),
        type || 'custom',
        enabled !== false ? 1 : 0,
        orderIndex !== undefined ? Number(orderIndex) : 0
      );
      res.status(201).json({ success: true, id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create contact link' });
    }
  });

  routes.put('/api/admin/contact-links/:id', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { label, icon, url, type, enabled, orderIndex } = req.body ?? {};
      const updates: string[] = [];
      const params: unknown[] = [];
      if (label !== undefined) {
        if (typeof label !== 'string' || label.trim().length === 0) {
          return res.status(400).json({ error: 'Label is required.' });
        }
        updates.push('label = ?');
        params.push(label.trim());
      }
      if (icon !== undefined) updates.push('icon = ?'), params.push(icon || 'link');
      if (url !== undefined) {
        if (typeof url !== 'string' || url.trim().length === 0) {
          return res.status(400).json({ error: 'Destination is required.' });
        }
        if (!parsePublicLink(url)) {
          return res.status(400).json({ error: 'Destination must use http, https, tel, mailto, or geo.' });
        }
        updates.push('url = ?');
        params.push(url.trim());
      }
      if (type !== undefined) updates.push('type = ?'), params.push(type);
      if (enabled !== undefined) updates.push('enabled = ?'), params.push(enabled ? 1 : 0);
      if (orderIndex !== undefined) updates.push('order_index = ?'), params.push(Number(orderIndex));
      if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
      params.push(id);
      await db.prepare(`UPDATE contact_links SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update contact link' });
    }
  });

  routes.delete('/api/admin/contact-links/:id', authenticateAdmin, async (_req, res) => {
    try {
      await db.prepare('DELETE FROM contact_links WHERE id = ?').run(_req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete contact link' });
    }
  });

  // --- Profile sections ---
  routes.get('/api/admin/profile-sections', authenticateAdmin, async (_req, res) => {
    try {
      const rows = await db.prepare('SELECT * FROM profile_sections ORDER BY order_index ASC, id ASC')
        .all() as { image: string | null }[];
      res.json(rows.map((row) => ({ ...row, image: parseOptionalImage(row.image) })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load profile sections' });
    }
  });

  routes.post('/api/admin/profile-sections', authenticateAdmin, async (req, res) => {
    try {
      const { title, description, image, sectionType, visible, orderIndex } = req.body ?? {};
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required.' });
      }
      const id = lowerHexId();
      await db.prepare(
        `INSERT INTO profile_sections (id, title, description, image, section_type, visible, order_index, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        title.trim(),
        description || null,
        parseOptionalImage(image),
        sectionType || 'content',
        visible !== false ? 1 : 0,
        orderIndex !== undefined ? Number(orderIndex) : 0,
        new Date().toISOString()
      );
      res.status(201).json({ success: true, id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create profile section' });
    }
  });

  routes.put('/api/admin/profile-sections/:id', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { title, description, image, sectionType, visible, orderIndex } = req.body ?? {};
      const updates: string[] = [];
      const params: unknown[] = [];
      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          return res.status(400).json({ error: 'Title is required.' });
        }
        updates.push('title = ?');
        params.push(title.trim());
      }
      if (description !== undefined) updates.push('description = ?'), params.push(description || null);
      if (image !== undefined) updates.push('image = ?'), params.push(parseOptionalImage(image));
      if (sectionType !== undefined) updates.push('section_type = ?'), params.push(sectionType);
      if (visible !== undefined) updates.push('visible = ?'), params.push(visible ? 1 : 0);
      if (orderIndex !== undefined) updates.push('order_index = ?'), params.push(Number(orderIndex));
      if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
      updates.push('updated_at = ?');
      params.push(new Date().toISOString(), id);
      await db.prepare(`UPDATE profile_sections SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update profile section' });
    }
  });

  routes.delete('/api/admin/profile-sections/:id', authenticateAdmin, async (_req, res) => {
    try {
      await db.prepare('DELETE FROM profile_sections WHERE id = ?').run(_req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete profile section' });
    }
  });

  // --- Categories ---
  routes.get('/api/admin/categories', authenticateAdmin, async (_req, res) => {
    try {
      const rows = await db.prepare(
          'SELECT c.*, COUNT(p.id) AS product_count FROM jewellery_categories c LEFT JOIN jewellery_products p ON p.category_id = c.id AND p.visible = 1 GROUP BY c.id ORDER BY c.order_index ASC, c.id ASC'
        )
        .all() as { image: string | null }[];
      res.json(rows.map((row) => ({ ...row, image: parseOptionalImage(row.image) })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load categories' });
    }
  });

  routes.post('/api/admin/categories', authenticateAdmin, async (req, res) => {
    try {
      const { name, slug, description, image, visible, featured, orderIndex } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Category name is required.' });
      }
      const derivedSlug =
        typeof slug === 'string' && slug.trim().length > 0
          ? slug.trim()
          : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!derivedSlug) {
        return res.status(400).json({ error: 'Unable to derive category slug.' });
      }
      try {
        const id = lowerHexId();
        await db.prepare(
          `INSERT INTO jewellery_categories (id, name, slug, description, image, visible, featured, order_index, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          name.trim(),
          derivedSlug,
          description || null,
          parseOptionalImage(image),
          visible !== false ? 1 : 0,
          featured ? 1 : 0,
          orderIndex !== undefined ? Number(orderIndex) : 0,
          new Date().toISOString()
        );
        res.status(201).json({ success: true, id, slug: derivedSlug });
      } catch (e: any) {
        if (e?.code === '23505') {
          return res.status(409).json({ error: 'A category with this slug already exists.' });
        }
        throw e;
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create category' });
    }
  });

  routes.put('/api/admin/categories/:id', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { name, slug, description, image, visible, featured, orderIndex } = req.body ?? {};
      const updates: string[] = [];
      const params: unknown[] = [];
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'Category name is required.' });
        }
        updates.push('name = ?');
        params.push(name.trim());
      }
      if (slug !== undefined) {
        if (typeof slug !== 'string' || slug.trim().length === 0) {
          return res.status(400).json({ error: 'Slug is required.' });
        }
        updates.push('slug = ?');
        params.push(slug.trim());
      }
      if (description !== undefined) updates.push('description = ?'), params.push(description || null);
      if (image !== undefined) updates.push('image = ?'), params.push(parseOptionalImage(image));
      if (visible !== undefined) updates.push('visible = ?'), params.push(visible ? 1 : 0);
      if (featured !== undefined) updates.push('featured = ?'), params.push(featured ? 1 : 0);
      if (orderIndex !== undefined) updates.push('order_index = ?'), params.push(Number(orderIndex));
      if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
      updates.push('updated_at = ?');
      params.push(new Date().toISOString(), id);
      try {
        await db.prepare(`UPDATE jewellery_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      } catch (e: any) {
        if (e?.code === '23505') {
          return res.status(409).json({ error: 'A category with this slug already exists.' });
        }
        throw e;
      }
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  routes.delete('/api/admin/categories/:id', authenticateAdmin, async (req, res) => {
    try {
      const inUse = await db.prepare('SELECT COUNT(*) AS c FROM jewellery_products WHERE category_id = ?')
        .get(req.params.id) as { c: number };
      if (inUse.c > 0) {
        return res.status(409).json({
          error: 'This category contains products and cannot be deleted. Move or delete its products first.',
        });
      }
      await db.prepare('DELETE FROM jewellery_categories WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete category' });
    }
  });

  // --- Products ---
  routes.get('/api/admin/products', authenticateAdmin, async (_req, res) => {
    try {
      const rows = await db.prepare(
          `SELECT p.*, c.name AS category_name, c.slug AS category_slug
           FROM jewellery_products p
           JOIN jewellery_categories c ON c.id = p.category_id
           ORDER BY p.order_index ASC, p.created_at DESC`
        )
        .all() as { images: string | null; [key: string]: unknown }[];
      const productIds = rows.map((p) => p.id as string);
      let imagesByProduct: Record<string, { id: string; url: string; orderIndex: number }[]> = {};
      if (productIds.length > 0) {
        const placeholders = productIds.map(() => '?').join(',');
        const imageRows = await db.prepare(
            `SELECT product_id, url, order_index, id FROM product_images WHERE product_id IN (${placeholders}) ORDER BY order_index ASC, id ASC`
          )
          .all(productIds) as { product_id: string; url: string; order_index: number; id: string }[];
        for (const row of imageRows) {
          if (!imagesByProduct[row.product_id]) imagesByProduct[row.product_id] = [];
          imagesByProduct[row.product_id].push({
            id: row.id,
            url: parseOptionalImage(row.url),
            orderIndex: row.order_index,
          });
        }
      }
      res.json(
        rows.map((p) => ({
          ...p,
          images: imagesByProduct[p.id as string] || [],
        }))
      );    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load products' });
    }
  });

  routes.post('/api/admin/products', authenticateAdmin, async (req, res) => {
    try {
      const {
        categoryId,
        name,
        description,
        material,
        price,
        available,
        featured,
        reference,
        visible,
        orderIndex,
        profileCard,
        images,
      } = req.body ?? {};

      if (!categoryId || typeof categoryId !== 'string') {
        return res.status(400).json({ error: 'Category is required.' });
      }
      const categoryExists = await db.prepare('SELECT 1 FROM jewellery_categories WHERE id = ?')
        .get(categoryId);
      if (!categoryExists) {
        return res.status(400).json({ error: 'Selected category does not exist.' });
      }
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Product name is required.' });
      }
      if (name.trim().length > 150) {
        return res.status(400).json({ error: 'Product name must be 150 characters or fewer.' });
      }
      if (price !== undefined && price !== null && price !== '' && typeof price !== 'string') {
        return res.status(400).json({ error: 'Invalid price.' });
      }
      if (reference !== undefined && reference !== null && reference !== '' && typeof reference !== 'string') {
        return res.status(400).json({ error: 'Invalid reference.' });
      }
      if (images !== undefined && !Array.isArray(images)) {
        return res.status(400).json({ error: 'Images must be an array.' });
      }
      if (Array.isArray(images) && images.some((image) => !isValidOptionalImage(image))) {
        return res.status(400).json({ error: 'Each product image must be a valid image URL or data image.' });
      }
      if (profileCard) {
        const profileCardCount = await db.prepare('SELECT COUNT(*) AS c FROM jewellery_products WHERE profile_card = 1')
          .get() as { c: number };
        if (profileCardCount.c >= 5) {
          return res.status(409).json({ error: 'A maximum of five jewellery profile cards can be selected.' });
        }
      }

      const id = lowerHexId();
      const now = new Date().toISOString();
      const createProduct = db.transaction(async () => {
        await db.prepare(
          `INSERT INTO jewellery_products (id, category_id, name, description, material, price, available, featured, reference, visible, order_index, profile_card, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          categoryId,
          name.trim(),
          description || null,
          material || null,
          price || null,
          available !== false ? 1 : 0,
          featured ? 1 : 0,
          reference || null,
          visible !== false ? 1 : 0,
          orderIndex !== undefined ? Number(orderIndex) : 0,
          profileCard ? 1 : 0,
          now
        );

        let imageIndex = 0;
        const insertImage = db.prepare(
          'INSERT INTO product_images (id, product_id, url, order_index) VALUES (?, ?, ?, ?)'
        );
        for (const url of (images ?? []) as string[]) {
          const parsed = parseOptionalImage(url);
          if (!parsed) continue;
          await insertImage.run(lowerHexId(), id, parsed, imageIndex++);
        }
      });
      await createProduct();

      res.status(201).json({ success: true, id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create product' });
    }
  });

  routes.put('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const {
        categoryId,
        name,
        description,
        material,
        price,
        available,
        featured,
        reference,
        visible,
        orderIndex,
        profileCard,
        images,
      } = req.body ?? {};

      if (images !== undefined && !Array.isArray(images)) {
        return res.status(400).json({ error: 'Images must be an array.' });
      }
      if (Array.isArray(images) && images.some((image) => !isValidOptionalImage(image))) {
        return res.status(400).json({ error: 'Each product image must be a valid image URL or data image.' });
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      if (categoryId !== undefined) {
        if (typeof categoryId !== 'string' || categoryId.length === 0) {
          return res.status(400).json({ error: 'Category is required.' });
        }
        const categoryExists = await db.prepare('SELECT 1 FROM jewellery_categories WHERE id = ?')
          .get(categoryId);
        if (!categoryExists) {
          return res.status(400).json({ error: 'Selected category does not exist.' });
        }
        updates.push('category_id = ?');
        params.push(categoryId);
      }
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'Product name is required.' });
        }
        if (name.trim().length > 150) {
          return res.status(400).json({ error: 'Product name must be 150 characters or fewer.' });
        }
        updates.push('name = ?');
        params.push(name.trim());
      }
      if (description !== undefined) updates.push('description = ?'), params.push(description || null);
      if (material !== undefined) updates.push('material = ?'), params.push(material || null);
      if (price !== undefined) updates.push('price = ?'), params.push(price || null);
      if (available !== undefined) updates.push('available = ?'), params.push(available ? 1 : 0);
      if (featured !== undefined) updates.push('featured = ?'), params.push(featured ? 1 : 0);
      if (reference !== undefined) updates.push('reference = ?'), params.push(reference || null);
      if (visible !== undefined) updates.push('visible = ?'), params.push(visible ? 1 : 0);
      if (orderIndex !== undefined) updates.push('order_index = ?'), params.push(Number(orderIndex));
      if (profileCard !== undefined) {
        if (profileCard) {
          const current = await db.prepare('SELECT profile_card FROM jewellery_products WHERE id = ?')
            .get(id) as { profile_card: number } | undefined;
          if (!current) return res.status(404).json({ error: 'Product not found.' });
          if (!current.profile_card) {
            const profileCardCount = await db.prepare('SELECT COUNT(*) AS c FROM jewellery_products WHERE profile_card = 1')
              .get() as { c: number };
            if (profileCardCount.c >= 5) {
              return res.status(409).json({ error: 'A maximum of five jewellery profile cards can be selected.' });
            }
          }
        }
        updates.push('profile_card = ?');
        params.push(profileCard ? 1 : 0);
      }
      updates.push('updated_at = ?');
      params.push(new Date().toISOString(), id);
      await db.prepare(`UPDATE jewellery_products SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      if (images !== undefined) {
        const replaceImages = db.transaction(async () => {
          await db.prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
          const insertImage = db.prepare(
            'INSERT INTO product_images (id, product_id, url, order_index) VALUES (?, ?, ?, ?)'
          );
          let imageIndex = 0;
          for (const url of images as string[]) {
            const parsed = parseOptionalImage(url);
            if (!parsed) continue;
            await insertImage.run(lowerHexId(), id, parsed, imageIndex++);
          }
        });
        await replaceImages();
      }

      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update product' });
    }
  });

  routes.delete('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
    try {
      await db.prepare('DELETE FROM jewellery_products WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  });

  // --- Admin orders ---
  routes.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
    try {
      const search =
        typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const statusFilter =
        typeof req.query.status === 'string' ? req.query.status : undefined;

      let sql = `SELECT reference, customer_name, phone, delivery_location, notes, internal_notes, status, created_at, updated_at
                 FROM customer_orders WHERE 1 = 1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND (customer_name ILIKE ? OR phone ILIKE ? OR reference ILIKE ?)`;
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (statusFilter) {
        sql += ' AND status = ?';
        params.push(statusFilter);
      }
      sql += ' ORDER BY created_at DESC';

      const rows = await db.prepare(sql).all(params) as {
        [key: string]: unknown;
      }[];
      const result = [];
      for (const row of rows) {
        const items = await db.prepare(
            'SELECT * FROM customer_order_items WHERE order_id = (SELECT id FROM customer_orders WHERE reference = ?)'
          )
          .all(row.reference);
        result.push({ ...row, items });
      }
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load orders' });
    }
  });

  routes.get('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
    try {
      const order = await db.prepare('SELECT * FROM customer_orders WHERE id = ? OR reference = ?')
        .get(req.params.id, req.params.id) as {
          [key: string]: unknown;
        } | undefined;
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const items = await db.prepare('SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id ASC')
        .all(order.id);
      const history = await db.prepare(
          'SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC'
        )
        .all(order.id);
      res.json({ ...order, items, statusHistory: history });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load order' });
    }
  });

  routes.put('/api/admin/orders/:id/status', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { status, note, internalNotes } = req.body ?? {};
      const validStatuses = [
        'pending',
        'confirmed',
        'processing',
        'ready',
        'completed',
        'cancelled',
      ];
      if (typeof status !== 'string' || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid order status.' });
      }
      if (internalNotes !== undefined && (typeof internalNotes !== 'string' || internalNotes.length > 2000)) {
        return res.status(400).json({ error: 'Internal notes must be 2,000 characters or fewer.' });
      }
      if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
        return res.status(400).json({ error: 'Status notes must be 500 characters or fewer.' });
      }

      const order = await db.prepare('SELECT id FROM customer_orders WHERE id = ? OR reference = ?')
        .get(id, id) as { id: string } | undefined;
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const now = new Date().toISOString();
      const saveStatus = db.transaction(async () => {
        await db.prepare(
          `UPDATE customer_orders
           SET status = ?, internal_notes = COALESCE(?, internal_notes), updated_at = ?
           WHERE id = ?`
        ).run(status, internalNotes ?? null, now, order.id);
        await db.prepare(
          'INSERT INTO order_status_history (id, order_id, status, note, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(lowerHexId(), order.id, status, note || null, now);
      });
      await saveStatus();
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update order status' });
    }
  });

  // --- Admin customer inquiries / messages ---
  routes.get('/api/admin/inquiries', authenticateAdmin, async (req, res) => {
    try {
      const search =
        typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const statusFilter =
        typeof req.query.status === 'string' ? req.query.status : undefined;
      const telegramFilter =
        typeof req.query.telegramStatus === 'string'
          ? req.query.telegramStatus
          : undefined;
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

      let sql = `SELECT id, reference, customer_name, phone_number, email, message, status,
                         telegram_delivery_status, telegram_message_id, telegram_delivered_at, telegram_error,
                         telegram_retry_count, internal_notes, created_at, updated_at
                 FROM customer_inquiries WHERE 1 = 1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND (customer_name ILIKE ? OR phone_number ILIKE ? OR reference ILIKE ?)`;
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (statusFilter) {
        sql += ' AND status = ?';
        params.push(statusFilter);
      }
      if (telegramFilter) {
        sql += ' AND telegram_delivery_status = ?';
        params.push(telegramFilter);
      }
      if (dateFrom) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || Number.isNaN(Date.parse(`${dateFrom}T00:00:00Z`))) {
          return res.status(400).json({ error: 'Invalid start date.' });
        }
        sql += " AND created_at::date >= ?::date";
        params.push(dateFrom);
      }
      if (dateTo) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || Number.isNaN(Date.parse(`${dateTo}T00:00:00Z`))) {
          return res.status(400).json({ error: 'Invalid end date.' });
        }
        sql += " AND created_at::date <= ?::date";
        params.push(dateTo);
      }
      sql += ' ORDER BY created_at DESC';

      const rows = await db.prepare(sql).all(params);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load inquiries' });
    }
  });

  routes.get('/api/admin/inquiries/:id', authenticateAdmin, async (req, res) => {
    try {
      const inquiry = await db.prepare(
          'SELECT * FROM customer_inquiries WHERE id = ? OR reference = ?'
        )
        .get(req.params.id, req.params.id);
      if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' });
      res.json(inquiry);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load inquiry' });
    }
  });

  routes.put('/api/admin/inquiries/:id/status', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { status } = req.body ?? {};
      if (typeof status !== 'string' || !['new', 'contacted', 'resolved', 'archived'].includes(status)) {
        return res.status(400).json({ error: 'Invalid inquiry status.' });
      }
      await db.prepare(
        'UPDATE customer_inquiries SET status = ?, updated_at = ? WHERE id = ? OR reference = ?'
      ).run(status, new Date().toISOString(), id, id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update inquiry status' });
    }
  });

  routes.put('/api/admin/inquiries/:id/notes', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { internalNotes } = req.body ?? {};
      if (typeof internalNotes !== 'string' || internalNotes.length > 2000) {
        return res.status(400).json({ error: 'Notes must be text no longer than 2,000 characters.' });
      }
      await db.prepare(
        'UPDATE customer_inquiries SET internal_notes = ?, updated_at = ? WHERE id = ? OR reference = ?'
      ).run(internalNotes, new Date().toISOString(), id, id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save notes' });
    }
  });

  routes.post('/api/admin/inquiries/:id/retry-telegram', authenticateAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const inquiry = await db.prepare(
          'SELECT * FROM customer_inquiries WHERE id = ? OR reference = ?'
        )
        .get(id, id) as {
          id: string;
          reference: string;
          customer_name: string;
          phone_number: string;
          email: string | null;
          message: string;
          created_at: string;
          telegram_delivery_status: string;
        } | undefined;
      if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' });
      if (inquiry.telegram_delivery_status === 'sent') {
        return res.status(409).json({ error: 'This notification was already delivered.' });
      }

      const text = formatInquiryTelegramMessage({
        reference: inquiry.reference,
        customerName: inquiry.customer_name,
        phoneNumber: inquiry.phone_number,
        email: inquiry.email,
        message: inquiry.message,
        createdAt: inquiry.created_at,
      });
      const delivery = await attemptTelegramDelivery(inquiry.id, text);
      res.json({
        success: delivery.status === 'sent',
        status: delivery.status,
        messageId: delivery.messageId,
        error: delivery.error,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to retry Telegram notification' });
    }
  });

  // --- Admin footer settings ---
  routes.get('/api/admin/footer-settings', authenticateAdmin, async (_req, res) => {
    try {
      const row = await db.prepare("SELECT * FROM footer_settings WHERE id = 'single'")
        .get() as {
          additional_links: string | null;
          [key: string]: unknown;
        } | undefined;
      if (!row) return res.status(404).json({ error: 'Footer settings not found' });
      res.json({ ...row, additional_links: parseJson(row.additional_links, []) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load footer settings' });
    }
  });

  routes.put('/api/admin/footer-settings', authenticateAdmin, async (req, res) => {
    try {
      const {
        footerLogo,
        copyright,
        businessDescription,
        contactInfo,
        visible,
        additionalLinks,
      } = req.body ?? {};

      if (footerLogo !== undefined) {
        const parsed = parseOptionalImage(footerLogo);
        if (parsed === null && footerLogo !== null && footerLogo !== '') {
          return res.status(400).json({ error: 'Invalid footer logo image.' });
        }
      }
      if (additionalLinks !== undefined && !Array.isArray(additionalLinks)) {
        return res.status(400).json({ error: 'Additional links must be an array.' });
      }
      if (Array.isArray(additionalLinks) && (
        additionalLinks.length > 20 ||
        additionalLinks.some((link) =>
          !link ||
          typeof link !== 'object' ||
          typeof link.label !== 'string' ||
          link.label.trim().length === 0 ||
          link.label.length > 80 ||
          typeof link.url !== 'string' ||
          !parsePublicLink(link.url)
        )
      )) {
        return res.status(400).json({ error: 'Each footer link needs a label and a safe http, https, tel, mailto, or geo URL (maximum 20 links).' });
      }

      await db.prepare(
        `UPDATE footer_settings SET
          footer_logo = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, footer_logo) END,
          copyright = COALESCE(?, copyright),
          business_description = COALESCE(?, business_description),
          contact_info = COALESCE(?, contact_info),
          visible = COALESCE(?, visible),
          additional_links = COALESCE(?, additional_links)
        WHERE id = 'single'`
      ).run(
        footerLogo === null || footerLogo === '' ? 1 : 0,
        footerLogo !== undefined ? parseOptionalImage(footerLogo) : null,
        copyright !== undefined ? copyright : null,
        businessDescription !== undefined ? businessDescription : null,
        contactInfo !== undefined ? contactInfo : null,
        visible !== undefined ? (visible ? 1 : 0) : null,
        additionalLinks !== undefined ? JSON.stringify(additionalLinks) : null
      );
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save footer settings' });
    }
  });

  // --- Admin Telegram settings (status only — never expose the token) ---
  routes.get('/api/admin/telegram-settings', authenticateAdmin, async (_req, res) => {
    res.json({
      configured: TELEGRAM_CONFIGURED,
      ownerChatIdSet: TELEGRAM_OWNER_CHAT_ID.length > 0,
      botTokenSet: TELEGRAM_BOT_TOKEN.length > 0,
    });
  });

  // ============================================================================
  // Unknown API routes must return JSON 404s — never the SPA's index.html.
  // ============================================================================
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ============================================================================
  // Vite middleware (development) or static serving (production)
  // ============================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      console.error(
        `[static] Built frontend not found at ${distPath} — run "npm run build" first.`
      );
    }
    app.use(express.static(distPath));
    routes.get('*', async (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ============================================================================
  // Central error handler — never leaks stack traces to clients.
  // ============================================================================
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if ((err as { type?: string })?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large' });
    }
    console.error('Unhandled server error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const app = await createApp();
export default app;

if (!process.env.VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`AMDE JEWELLERY server running on port ${PORT}`);
    console.log('Database: SQLite');
    console.log(`Telegram configured: ${TELEGRAM_CONFIGURED ? 'yes' : 'no'}`);
    const networkInterfaces = os.networkInterfaces();
    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`Network access: http://${net.address}:${PORT}`);
        }
      }
    }
  });

  server.on('error', (listenError) => {
    console.error('FATAL: server could not start listening:', listenError);
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down gracefully...`);
    server.close(() => {
      sqlite.close();
      console.log('SQLite closed. Goodbye.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
