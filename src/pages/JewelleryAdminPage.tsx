import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Clock3,
  Gem,
  ImagePlus,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Mail,
  MessageSquareText,
  Palette,
  Save,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import JewelleryProfileCards from '../components/admin/JewelleryProfileCards';

type Tab = 'overview' | 'profile' | 'contacts' | 'collections' | 'products' | 'orders' | 'messages' | 'appearance' | 'sections' | 'footer' | 'telegram';
type ApiRecord = Record<string, any>;

const navigation: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'profile', label: 'Business profile', icon: Settings },
  { id: 'contacts', label: 'Contact links', icon: Link2 },
  { id: 'collections', label: 'Collections', icon: Gem },
  { id: 'products', label: 'Jewellery cards', icon: ShoppingBag },
  { id: 'orders', label: 'Orders', icon: BarChart3 },
  { id: 'messages', label: 'Customer messages', icon: MessageSquareText },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'sections', label: 'Profile sections', icon: Settings },
  { id: 'footer', label: 'Footer', icon: LayoutDashboard },
  { id: 'telegram', label: 'Telegram', icon: ShieldCheck },
];

const inputClass = 'mt-1 w-full rounded-xl border border-[#dfd8cc] bg-white px-3 py-2.5 text-sm text-[#2e281f] outline-none focus:border-[#b99548] focus:ring-2 focus:ring-[#b99548]/20';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#8d692b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#725321] disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#dfd8cc] bg-white px-4 py-2 text-sm font-semibold text-[#40392f] transition hover:bg-[#f8f5ef] disabled:opacity-50';

async function imageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 7 * 1024 * 1024) throw new Error('Images must be smaller than 7 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-[#514a40]">{label}{children}</label>;
}

export default function JewelleryAdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [dbChecking, setDbChecking] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<ApiRecord | null>(null);
  const [profile, setProfile] = useState<ApiRecord>({});
  const [profileOriginal, setProfileOriginal] = useState<ApiRecord>({});
  const [contacts, setContacts] = useState<ApiRecord[]>([]);
  const [categories, setCategories] = useState<ApiRecord[]>([]);
  const [orders, setOrders] = useState<ApiRecord[]>([]);
  const [inquiries, setInquiries] = useState<ApiRecord[]>([]);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageStatus, setMessageStatus] = useState('');
  const [telegramFilter, setTelegramFilter] = useState('');
  const [messageDateFrom, setMessageDateFrom] = useState('');
  const [messageDateTo, setMessageDateTo] = useState('');
  const [telegramStatus, setTelegramStatus] = useState<ApiRecord | null>(null);
  const [themeSettings, setThemeSettings] = useState<ApiRecord>({});
  const [sections, setSections] = useState<ApiRecord[]>([]);
  const [footer, setFooter] = useState<ApiRecord>({});
  const [footerLinksText, setFooterLinksText] = useState('[]');
  const [ordersStatus, setOrdersStatus] = useState('');
  const [ordersSearch, setOrdersSearch] = useState('');

  const api = useCallback(async (url: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      setAuthenticated(false);
      sessionStorage.removeItem('amdeAdminSignedIn');
      throw new Error('Your admin session expired. Please sign in again.');
    }
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    return data;
  }, []);

  const loadTab = useCallback(async (selected: Tab = tab) => {
    setBusy(true);
    setError('');
    try {
      if (selected === 'overview') setDashboard(await api('/api/admin/dashboard'));
      if (selected === 'profile') {
        const row = await api('/api/admin/business-profile');
        setProfile(row);
        setProfileOriginal(row);
      }
      if (selected === 'contacts') setContacts(await api('/api/admin/contact-links'));
      if (selected === 'collections') setCategories(await api('/api/admin/categories'));
      if (selected === 'products') setCategories(await api('/api/admin/categories'));
      if (selected === 'orders') {
        const query = new URLSearchParams();
        if (ordersSearch.trim()) query.set('search', ordersSearch.trim());
        if (ordersStatus) query.set('status', ordersStatus);
        setOrders(await api(`/api/admin/orders?${query}`));
      }
      if (selected === 'messages') {
        const query = new URLSearchParams();
        if (messageSearch.trim()) query.set('search', messageSearch.trim());
        if (messageStatus) query.set('status', messageStatus);
        if (telegramFilter) query.set('telegramStatus', telegramFilter);
        if (messageDateFrom) query.set('dateFrom', messageDateFrom);
        if (messageDateTo) query.set('dateTo', messageDateTo);
        setInquiries(await api(`/api/admin/inquiries?${query}`));
      }
      if (selected === 'appearance') setThemeSettings(await api('/api/admin/theme-settings'));
      if (selected === 'sections') setSections(await api('/api/admin/profile-sections'));
      if (selected === 'footer') {
        const footerData = await api('/api/admin/footer-settings');
        setFooter(footerData);
        setFooterLinksText(JSON.stringify(footerData.additional_links ?? [], null, 2));
      }
      if (selected === 'telegram') setTelegramStatus(await api('/api/admin/telegram-settings'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load this admin section.');
    } finally {
      setBusy(false);
    }
  }, [api, messageDateFrom, messageDateTo, messageSearch, messageStatus, ordersSearch, ordersStatus, tab, telegramFilter]);

  useEffect(() => {
    let active = true;
    const verifySession = async () => {
      if (!sessionStorage.getItem('amdeAdminSignedIn')) {
        if (active) setAuthChecked(true);
        return;
      }
      try {
        await api('/api/admin/me');
        if (active) setAuthenticated(true);
      } catch {
        sessionStorage.removeItem('amdeAdminSignedIn');
      } finally {
        if (active) setAuthChecked(true);
      }
    };
    void verifySession();
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (authenticated) void loadTab(tab);
  }, [authenticated, tab, loadTab]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await action();
      setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The requested change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    console.log("username", username)
    console.log("password", password)
    event.preventDefault();
    setBusy(true);
    setLoginError('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      console.log(data);
      if (!data.success) throw new Error(data.error || 'Invalid username or password.');
      sessionStorage.setItem('amdeAdminSignedIn', 'true');
      setPassword('');
      setAuthenticated(true);
    } catch (authError) {
      setLoginError(authError instanceof Error ? authError.message : 'Sign in failed.');
    } finally {
      setBusy(false);
      setAuthChecked(true);
    }
  };

  const checkDatabase = async () => {
    setDbChecking(true);
    setDbHealth(null);
    try {
      const response = await fetch('/api/health', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      console.log("Database health check response:", data);
      if (response.ok && data.status === 'ok') {
        setDbHealth({ ok: true, message: `Database reachable (${data.database ?? 'sqlite'}).` });
      } else {
        setDbHealth({ ok: false, message: data.error || `Database check failed (HTTP ${response.status}).` });
      }
    } catch (err) {
      setDbHealth({ ok: false, message: err instanceof Error ? err.message : 'Could not reach the server.' });
    } finally {
      setDbChecking(false);
    }
  };
  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (logoutError) {
      console.error('Admin logout failed:', logoutError);
    }
    sessionStorage.removeItem('amdeAdminSignedIn');
    setAuthenticated(false);
  };
  const mutateRecord = <T extends ApiRecord>(records: T[], setRecords: (rows: T[]) => void, id: string, values: Partial<T>) => {
    setRecords(records.map((record) => record.id === id ? { ...record, ...values } : record));
  };

  const publicContactTypes = useMemo(() => ['phone', 'whatsapp', 'telegram', 'instagram', 'facebook', 'tiktok', 'location', 'email', 'custom'], []);

  if (!authChecked) {
    return <div className="grid min-h-screen place-items-center bg-[#f7f4ed]"><LoaderCircle className="animate-spin text-[#8d692b]" /></div>;
  }

  if (!authenticated) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f4ed] p-4">
        <form onSubmit={login} className="w-full max-w-md rounded-3xl border border-[#e5dccb] bg-white p-7 shadow-xl">
          <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-[#796d59]"><ArrowLeft size={16} /> Back to profile</Link>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full border border-[#d1b473] font-serif text-2xl text-[#8d692b]">A</div>
            <h1 className="font-serif text-3xl font-semibold text-[#30281d]">AMDE JEWELLERY</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#9a8b73]">Admin access</p>
          </div>
          {loginError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{loginError}</p>}
          <Field label="Username"><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className={inputClass} /></Field>
          <Field label="Password"><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} /></Field>
          <button type="button" disabled={busy || dbChecking} className={`mt-2 w-full ${dbHealth?.ok ? 'bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed' : 'border border-[#dfd8cc] bg-white px-4 py-2 text-sm font-semibold text-[#40392f] transition hover:bg-[#f8f5ef] disabled:opacity-50 disabled:cursor-not-allowed'} rounded-xl inline-flex items-center justify-center gap-2 min-h-10`} onClick={() => void checkDatabase()}>
            {dbChecking ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{dbChecking ? ' Checking…' : ' Check database connection'}
          </button>
          {dbHealth && <p role="status" className={`mt-2 text-sm text-center ${dbHealth.ok ? 'text-green-800' : 'text-red-700'}`}>{dbHealth.message}</p>}
          <button type="submit" disabled={busy} className={`${buttonClass} mt-5 w-full`}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ed] text-[#30281d]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#e5dccb] bg-white/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="View business profile" className="grid h-10 w-10 place-items-center rounded-full border border-[#e5dccb] bg-[#faf8f3]"><ArrowLeft size={18} /></Link>
          <div><h1 className="font-serif text-xl font-semibold sm:text-2xl">AMDE JEWELLERY</h1><p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#9a8b73]">Business profile dashboard</p></div>
        </div>
        <button type="button" onClick={() => void logout()} className={secondaryButtonClass}><LogOut size={15} /> <span className="hidden sm:inline">Sign out</span></button>
      </header>

      <div className="mx-auto flex max-w-[1500px] gap-6 p-3 sm:p-5 lg:p-8">
        <aside className="hidden w-56 shrink-0 self-start rounded-2xl border border-[#e5dccb] bg-white p-2 lg:block">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => { setTab(id); setNotice(''); setError(''); }} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${tab === id ? 'bg-[#f3ecdf] font-semibold text-[#785c2f]' : 'text-[#685f52] hover:bg-[#faf8f3]'}`}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-2 lg:hidden">
            {navigation.map(({ id, label }) => <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 rounded-full border px-3 py-2 text-xs ${tab === id ? 'border-[#b99548] bg-[#f3ecdf] text-[#785c2f]' : 'border-[#e5dccb] bg-white'}`}>{label}</button>)}
          </div>
          {notice && <p role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
          {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
          {busy && <div className="mb-3 flex items-center gap-2 text-sm text-[#887b68]"><LoaderCircle size={16} className="animate-spin" /> Working…</div>}

          {tab === 'overview' && (
            <section>
              <h2 className="mb-5 font-serif text-3xl">Dashboard overview</h2>
              {dashboard && <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Total products', dashboard.stats.totalProducts],
                    ['Active products', dashboard.stats.activeProducts],
                    ['Collections', dashboard.stats.totalCategories],
                    ['Total orders', dashboard.stats.totalOrders],
                    ['Pending orders', dashboard.stats.pendingOrders],
                    ['Confirmed orders', dashboard.stats.confirmedOrders],
                    ['Completed orders', dashboard.stats.completedOrders],
                    ['Customer messages', dashboard.stats.totalInquiries],
                    ['New messages', dashboard.stats.newMessages],
                    ['Failed Telegram', dashboard.stats.failedTelegram],
                  ].map(([label, count]) => <div key={String(label)} className="rounded-2xl border border-[#e5dccb] bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[#95866f]">{label}</p><p className="mt-2 font-serif text-3xl">{count ?? 0}</p></div>)}
                </div>
                <div className="mt-6 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-[#e5dccb] bg-white p-5"><h3 className="mb-3 font-semibold">Recent orders</h3>{dashboard.recentOrders?.length ? dashboard.recentOrders.map((row: ApiRecord) => <p key={row.reference} className="border-t py-2 text-sm">{row.reference} · {row.customer_name} · {row.status}</p>) : <p className="text-sm text-gray-500">No orders yet.</p>}</div>
                  <div className="rounded-2xl border border-[#e5dccb] bg-white p-5"><h3 className="mb-3 font-semibold">Recent messages</h3>{dashboard.recentInquiries?.length ? dashboard.recentInquiries.map((row: ApiRecord) => <p key={row.reference} className="border-t py-2 text-sm">{row.reference} · {row.customer_name} · Telegram {row.telegram_delivery_status}</p>) : <p className="text-sm text-gray-500">No customer messages yet.</p>}</div>
                </div>
              </>}
            </section>
          )}

          {tab === 'profile' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <div className="mb-5 flex items-center justify-between"><div><h2 className="font-serif text-3xl">Business profile</h2><p className="mt-1 text-sm text-gray-500">These published details appear on the customer profile.</p></div><Link to="/" target="_blank" className={secondaryButtonClass}>Preview profile</Link></div>
              {profile.logo && <img src={profile.logo} alt="Business logo preview" className="mb-3 h-24 w-24 rounded-full border object-cover" />}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Business name"><input className={inputClass} value={profile.name ?? ''} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></Field>
                <Field label="Business category"><input className={inputClass} value={profile.category ?? ''} onChange={(event) => setProfile({ ...profile, category: event.target.value })} /></Field>
                <Field label="Tagline"><input className={inputClass} value={profile.tagline ?? ''} onChange={(event) => setProfile({ ...profile, tagline: event.target.value })} /></Field>
                <Field label="Location"><input className={inputClass} value={profile.location ?? ''} onChange={(event) => setProfile({ ...profile, location: event.target.value })} /></Field>
                <Field label="Physical address"><input className={inputClass} value={profile.address ?? ''} onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></Field>
                <Field label="Contact email"><input type="email" className={inputClass} value={profile.contact_email ?? ''} onChange={(event) => setProfile({ ...profile, contact_email: event.target.value })} /></Field>
                <Field label="Introduction"><textarea rows={3} className={inputClass} value={profile.introduction ?? ''} onChange={(event) => setProfile({ ...profile, introduction: event.target.value })} /></Field>
                <Field label="Description"><textarea rows={3} className={inputClass} value={profile.description ?? ''} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></Field>
                <Field label="Opening hours (JSON by weekday)"><textarea rows={3} className={inputClass} value={typeof profile.opening_hours === 'string' ? profile.opening_hours : JSON.stringify(profile.opening_hours ?? {}, null, 2)} onChange={(event) => setProfile({ ...profile, opening_hours: event.target.value })} /></Field>
                <Field label="Profile images (one URL per line)"><textarea rows={3} className={inputClass} value={Array.isArray(profile.images) ? profile.images.join('\n') : ''} onChange={(event) => setProfile({ ...profile, images: event.target.value.split('\n').map((line: string) => line.trim()).filter(Boolean) })} /></Field>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className={secondaryButtonClass}><ImagePlus size={16} /> Upload / replace logo<input type="file" accept="image/*" className="hidden" onChange={async (event) => { try { const file = event.target.files?.[0]; if (file) setProfile({ ...profile, logo: await imageAsDataUrl(file) }); } catch (imageError) { setError(imageError instanceof Error ? imageError.message : 'Could not use that image.'); } }} /></label>
                {profile.logo && <button type="button" className={secondaryButtonClass} onClick={() => setProfile({ ...profile, logo: null })}><Trash2 size={15} /> Remove logo</button>}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(profile.visible)} onChange={(event) => setProfile({ ...profile, visible: event.target.checked ? 1 : 0 })} /> Profile is published</label>
                <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => {
                  let openingHours = profile.opening_hours;
                  if (typeof openingHours === 'string') {
                    try { openingHours = JSON.parse(openingHours); } catch { throw new Error('Opening hours must be valid JSON.'); }
                  }
                  await api('/api/admin/business-profile', { method: 'PUT', body: JSON.stringify({ ...profile, contactEmail: profile.contact_email ?? '', openingHours, images: Array.isArray(profile.images) ? profile.images : [] }) });
                  setProfileOriginal(profile);
                }, 'Business profile saved and published.')}><Save size={16} /> Save changes</button>
                <button type="button" className={secondaryButtonClass} onClick={() => setProfile(profileOriginal)}>Reset unsaved</button>
              </div>
            </section>
          )}

          {tab === 'contacts' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-serif text-3xl">Contact links</h2><p className="text-sm text-gray-500">Only enabled links with a destination show publicly.</p></div><button type="button" className={buttonClass} onClick={() => setContacts([...contacts, { id: `new-${Date.now()}`, label: '', icon: 'link', url: '', type: 'custom', enabled: 1, order_index: contacts.length }])}>Add a link</button></div>
              <div className="space-y-3">
                {contacts.map((link) => <div key={link.id} className="grid gap-2 rounded-xl border border-[#ebe5db] p-3 md:grid-cols-[1fr_1fr_1.5fr_1fr_auto_auto]">
                  <input aria-label="Link label" className={inputClass} value={link.label} placeholder="Label" onChange={(event) => mutateRecord(contacts, setContacts, link.id, { label: event.target.value })} />
                  <select aria-label="Link type" className={inputClass} value={link.type} onChange={(event) => mutateRecord(contacts, setContacts, link.id, { type: event.target.value, icon: event.target.value })}>{publicContactTypes.map((type) => <option key={type}>{type}</option>)}</select>
                  <input aria-label="Destination URL" className={inputClass} value={link.url ?? ''} placeholder="tel:+251... / https://..." onChange={(event) => mutateRecord(contacts, setContacts, link.id, { url: event.target.value })} />
                  <input aria-label="Display order" type="number" className={inputClass} value={link.order_index} onChange={(event) => mutateRecord(contacts, setContacts, link.id, { order_index: Number(event.target.value) })} />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(link.enabled)} onChange={(event) => mutateRecord(contacts, setContacts, link.id, { enabled: event.target.checked ? 1 : 0 })} />Enabled</label>
                  <div className="flex gap-1">
                    <button type="button" aria-label="Save link" className="rounded-lg bg-[#f3ecdf] p-2 text-[#785c2f]" onClick={() => void run(async () => {
                      const payload = { label: link.label, icon: link.icon, url: link.url, type: link.type, enabled: Boolean(link.enabled), orderIndex: link.order_index };
                      if (link.id.startsWith('new-')) await api('/api/admin/contact-links', { method: 'POST', body: JSON.stringify(payload) });
                      else await api(`/api/admin/contact-links/${link.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                      await loadTab('contacts');
                    }, 'Contact link saved.')}><Save size={16} /></button>
                    <button type="button" aria-label="Delete link" className="rounded-lg bg-red-50 p-2 text-red-600" onClick={() => { if (window.confirm(`Delete "${link.label || 'this link'}"?`)) void run(async () => { if (!link.id.startsWith('new-')) await api(`/api/admin/contact-links/${link.id}`, { method: 'DELETE' }); setContacts((rows) => rows.filter((item) => item.id !== link.id)); }, 'Contact link deleted.'); }}><Trash2 size={16} /></button>
                  </div>
                </div>)}
              </div>
            </section>
          )}

          {tab === 'collections' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <div className="mb-5 flex items-center justify-between gap-2"><div><h2 className="font-serif text-3xl">Jewellery collections</h2><p className="text-sm text-gray-500">Categories are displayed in a horizontal carousel.</p></div><button type="button" className={buttonClass} onClick={() => setCategories([...categories, { id: `new-${Date.now()}`, name: '', slug: '', description: '', image: '', visible: 1, featured: 0, order_index: categories.length }])}>Add collection</button></div>
              <div className="space-y-3">
                {categories.map((category) => <div key={category.id} className="grid gap-2 rounded-xl border border-[#ebe5db] p-3 md:grid-cols-[1fr_1fr_1.5fr_auto_auto_auto_auto]">
                  <input aria-label="Collection name" className={inputClass} value={category.name} placeholder="Collection name" onChange={(event) => mutateRecord(categories, setCategories, category.id, { name: event.target.value, slug: event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') })} />
                  <input aria-label="Slug" className={inputClass} value={category.slug} placeholder="slug" onChange={(event) => mutateRecord(categories, setCategories, category.id, { slug: event.target.value })} />
                  <input aria-label="Description" className={inputClass} value={category.description ?? ''} placeholder="Description" onChange={(event) => mutateRecord(categories, setCategories, category.id, { description: event.target.value })} />
                  <label className={`${secondaryButtonClass} cursor-pointer`}><ImagePlus size={15} />{category.image ? 'Replace image' : 'Add image'}<input type="file" accept="image/*" className="hidden" onChange={async (event) => { try { const file = event.target.files?.[0]; if (file) mutateRecord(categories, setCategories, category.id, { image: await imageAsDataUrl(file) }); } catch (imageError) { setError(imageError instanceof Error ? imageError.message : 'Could not use that image.'); } }} /></label>
                  <input aria-label="Order" type="number" className={inputClass} value={category.order_index} onChange={(event) => mutateRecord(categories, setCategories, category.id, { order_index: Number(event.target.value) })} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(category.visible)} onChange={(event) => mutateRecord(categories, setCategories, category.id, { visible: event.target.checked ? 1 : 0 })} />Visible</label>
                  <div className="flex gap-1">
                    <button type="button" aria-label="Save collection" className="rounded-lg bg-[#f3ecdf] p-2 text-[#785c2f]" onClick={() => void run(async () => {
                      const payload = { name: category.name, slug: category.slug, description: category.description, image: category.image, visible: Boolean(category.visible), featured: Boolean(category.featured), orderIndex: category.order_index };
                      if (category.id.startsWith('new-')) await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
                      else await api(`/api/admin/categories/${category.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                      await loadTab('collections');
                    }, 'Collection saved.')}><Save size={16} /></button>
                    <button type="button" aria-label="Delete collection" className="rounded-lg bg-red-50 p-2 text-red-600" onClick={() => { if (window.confirm(`Delete "${category.name}"? Categories with products cannot be deleted.`)) void run(async () => { await api(`/api/admin/categories/${category.id}`, { method: 'DELETE' }); await loadTab('collections'); }, 'Collection deleted.'); }}><Trash2 size={16} /></button>
                  </div>
                </div>)}
              </div>
            </section>
          )}

          {tab === 'products' && <JewelleryProfileCards />}

          {tab === 'orders' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <div className="mb-4 flex flex-wrap gap-2"><h2 className="mr-auto font-serif text-3xl">Orders</h2><input value={ordersSearch} onChange={(event) => setOrdersSearch(event.target.value)} placeholder="Search name, phone, reference" className={`${inputClass} mt-0 max-w-xs`} /><select value={ordersStatus} onChange={(event) => setOrdersStatus(event.target.value)} className={`${inputClass} mt-0 w-auto`}><option value="">All statuses</option>{['pending', 'confirmed', 'processing', 'ready', 'completed', 'cancelled'].map((status) => <option key={status}>{status}</option>)}</select><button type="button" onClick={() => void loadTab('orders')} className={secondaryButtonClass}>Search</button></div>
              <div className="space-y-3">{orders.map((order) => <OrderRow key={order.reference} order={order} api={api} onSaved={() => loadTab('orders')} />)}{!orders.length && <p className="py-8 text-center text-sm text-gray-500">No orders found.</p>}</div>
            </section>
          )}

          {tab === 'messages' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <div className="mb-4 flex flex-wrap gap-2">
                <h2 className="mr-auto font-serif text-3xl">Customer messages</h2>
                <input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Search name, phone, reference" className={`${inputClass} mt-0 max-w-xs`} />
                <select value={messageStatus} onChange={(event) => setMessageStatus(event.target.value)} className={`${inputClass} mt-0 w-auto`}><option value="">All inquiry statuses</option>{['new', 'contacted', 'resolved', 'archived'].map((status) => <option key={status}>{status}</option>)}</select>
                <select value={telegramFilter} onChange={(event) => setTelegramFilter(event.target.value)} className={`${inputClass} mt-0 w-auto`}><option value="">All Telegram statuses</option>{['pending', 'sent', 'failed'].map((status) => <option key={status}>{status}</option>)}</select>
                <input type="date" aria-label="Messages from date" value={messageDateFrom} onChange={(event) => setMessageDateFrom(event.target.value)} className={`${inputClass} mt-0 w-auto`} />
                <input type="date" aria-label="Messages to date" value={messageDateTo} onChange={(event) => setMessageDateTo(event.target.value)} className={`${inputClass} mt-0 w-auto`} />
                <button type="button" onClick={() => void loadTab('messages')} className={secondaryButtonClass}>Search</button>
              </div>
              <div className="space-y-3">{inquiries.map((inquiry) => <InquiryRow key={inquiry.id} inquiry={inquiry} api={api} onSaved={() => loadTab('messages')} />)}{!inquiries.length && <p className="py-8 text-center text-sm text-gray-500">No customer messages found.</p>}</div>
            </section>
          )}

          {tab === 'appearance' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <h2 className="mb-5 font-serif text-3xl">Appearance & themes</h2>
              <Field label="Default theme"><select className={inputClass} value={themeSettings.default_theme ?? 'creamy-golden'} onChange={(event) => setThemeSettings({ ...themeSettings, default_theme: event.target.value })}><option value="creamy-golden">Creamy Golden</option><option value="golden-black">Golden Black</option></select></Field>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                {[
                  ['gb', 'Golden Black'],
                  ['cg', 'Creamy Golden'],
                ].map(([prefix, label]) => <div key={prefix} className="rounded-2xl border border-[#ebe5db] p-4"><h3 className="mb-3 font-semibold">{label}</h3><div className="grid grid-cols-2 gap-3">{[['background', 'Background'], ['surface', 'Surface'], ['surface_secondary', 'Secondary surface'], ['primary_gold', 'Primary gold'], ['secondary_gold', 'Secondary gold'], ['primary_text', 'Text'], ['muted_text', 'Muted text']].map(([key, title]) => <label key={key} className="flex items-center gap-2 text-xs text-gray-600"><input type="color" value={themeSettings[`${prefix}_${key}`] || (prefix === 'gb' ? '#171717' : '#f4efe4')} onChange={(event) => setThemeSettings({ ...themeSettings, [`${prefix}_${key}`]: event.target.value })} className="h-8 w-10 cursor-pointer rounded border" />{title}</label>)}</div></div>)}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Heading font"><input className={inputClass} value={themeSettings.heading_font ?? 'Cormorant Garamond'} onChange={(event) => setThemeSettings({ ...themeSettings, heading_font: event.target.value })} /></Field><Field label="Body font"><input className={inputClass} value={themeSettings.body_font ?? 'Montserrat'} onChange={(event) => setThemeSettings({ ...themeSettings, body_font: event.target.value })} /></Field></div>
              <button type="button" className={`${buttonClass} mt-5`} onClick={() => void run(async () => { await api('/api/admin/theme-settings', { method: 'PUT', body: JSON.stringify(themeSettings) }); }, 'Theme settings saved.')}><Save size={16} /> Save theme settings</button>
            </section>
          )}

          {tab === 'sections' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <div className="mb-5 flex items-center justify-between"><div><h2 className="font-serif text-3xl">Profile sections</h2><p className="text-sm text-gray-500">Visibility and order are saved to SQLite.</p></div><button type="button" className={buttonClass} onClick={() => setSections([...sections, { id: `new-${Date.now()}`, title: '', description: '', visible: 1, order_index: sections.length, section_type: 'content' }])}>Add section</button></div>
              <div className="space-y-3">{sections.map((section) => <div key={section.id} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1fr_2fr_auto_auto_auto]"><input className={inputClass} value={section.title} placeholder="Section title" onChange={(event) => mutateRecord(sections, setSections, section.id, { title: event.target.value })} /><input className={inputClass} value={section.description ?? ''} placeholder="Description" onChange={(event) => mutateRecord(sections, setSections, section.id, { description: event.target.value })} /><input type="number" aria-label="Order" className={inputClass} value={section.order_index} onChange={(event) => mutateRecord(sections, setSections, section.id, { order_index: Number(event.target.value) })} /><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(section.visible)} onChange={(event) => mutateRecord(sections, setSections, section.id, { visible: event.target.checked ? 1 : 0 })} />Visible</label><div className="flex gap-1"><button type="button" className="rounded-lg bg-[#f3ecdf] p-2 text-[#785c2f]" onClick={() => void run(async () => { const payload = { title: section.title, description: section.description, visible: Boolean(section.visible), orderIndex: section.order_index, sectionType: section.section_type }; if (section.id.startsWith('new-')) await api('/api/admin/profile-sections', { method: 'POST', body: JSON.stringify(payload) }); else await api(`/api/admin/profile-sections/${section.id}`, { method: 'PUT', body: JSON.stringify(payload) }); await loadTab('sections'); }, 'Profile section saved.')}><Save size={16} /></button><button type="button" className="rounded-lg bg-red-50 p-2 text-red-600" onClick={() => { if (window.confirm('Delete this profile section?')) void run(async () => { if (!section.id.startsWith('new-')) await api(`/api/admin/profile-sections/${section.id}`, { method: 'DELETE' }); setSections((rows) => rows.filter((row) => row.id !== section.id)); }, 'Profile section deleted.'); }}><Trash2 size={16} /></button></div></div>)}</div>
            </section>
          )}

          {tab === 'footer' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7">
              <h2 className="mb-5 font-serif text-3xl">Footer settings</h2>
              {footer.footer_logo && <img src={footer.footer_logo} alt="Footer logo preview" className="mb-3 h-16 w-16 rounded-full object-cover" />}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Copyright"><input className={inputClass} value={footer.copyright ?? ''} onChange={(event) => setFooter({ ...footer, copyright: event.target.value })} /></Field>
                <Field label="Business description"><input className={inputClass} value={footer.business_description ?? ''} onChange={(event) => setFooter({ ...footer, business_description: event.target.value })} /></Field>
                <Field label="Contact information"><textarea rows={3} className={inputClass} value={footer.contact_info ?? ''} onChange={(event) => setFooter({ ...footer, contact_info: event.target.value })} /></Field>
                <Field label="Additional links (JSON array of label/url objects)"><textarea rows={3} className={inputClass} value={footerLinksText} onChange={(event) => { setFooterLinksText(event.target.value); try { setFooter({ ...footer, additional_links: JSON.parse(event.target.value), additional_links_text: '' }); } catch { setFooter({ ...footer, additional_links_text: event.target.value }); } }} /></Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-3"><label className={secondaryButtonClass}><ImagePlus size={16} /> Footer logo<input type="file" accept="image/*" className="hidden" onChange={async (event) => { try { const file = event.target.files?.[0]; if (file) setFooter({ ...footer, footer_logo: await imageAsDataUrl(file) }); } catch (imageError) { setError(imageError instanceof Error ? imageError.message : 'Could not use image.'); } }} /></label>{footer.footer_logo && <button type="button" className={secondaryButtonClass} onClick={() => setFooter({ ...footer, footer_logo: null })}>Remove footer logo</button>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(footer.visible)} onChange={(event) => setFooter({ ...footer, visible: event.target.checked ? 1 : 0 })} /> Footer visible</label><button type="button" className={buttonClass} onClick={() => void run(async () => { if (footer.additional_links_text) throw new Error('Additional links must be valid JSON.'); await api('/api/admin/footer-settings', { method: 'PUT', body: JSON.stringify({ footerLogo: footer.footer_logo, copyright: footer.copyright, businessDescription: footer.business_description, contactInfo: footer.contact_info, visible: Boolean(footer.visible), additionalLinks: footer.additional_links ?? [] }) }); }, 'Footer settings saved.')}><Save size={16} /> Save footer</button></div>
            </section>
          )}

          {tab === 'telegram' && (
            <section className="rounded-2xl border border-[#e5dccb] bg-white p-5 sm:p-7"><h2 className="mb-4 font-serif text-3xl">Telegram integration</h2><div className={`rounded-xl p-4 ${telegramStatus?.configured ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{telegramStatus?.configured ? 'Telegram is configured. Customer inquiries are sent to the administrator.' : 'Telegram is not configured. Inquiries continue to be saved in SQLite, but notifications cannot be delivered.'}</div><p className="mt-4 text-sm text-gray-600">Secrets are only read by the server and are never shown here.</p><div className="mt-4 rounded-xl border p-4 text-sm"><p>Bot token configured: {telegramStatus?.botTokenSet ? 'Yes' : 'No'}</p><p>Owner chat ID configured: {telegramStatus?.ownerChatIdSet ? 'Yes' : 'No'}</p></div><p className="mt-4 text-sm text-gray-500">Set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID in the server environment, then restart the app.</p></section>
          )}
        </main>
      </div>
    </div>
  );
}

function OrderRow({ order, api, onSaved }: { order: ApiRecord; api: (url: string, init?: RequestInit) => Promise<any>; onSaved: () => void }) {
  const [status, setStatus] = useState(order.status);
  const [internalNotes, setInternalNotes] = useState(order.internal_notes ?? '');
  const [statusNote, setStatusNote] = useState('');
  const [history, setHistory] = useState<ApiRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [rowError, setRowError] = useState('');
  const loadHistory = async () => {
    try {
      const data = await api(`/api/admin/orders/${encodeURIComponent(order.reference)}`);
      setHistory(data.statusHistory ?? []);
      setExpanded((current) => !current);
      setRowError('');
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Could not load order history.');
    }
  };
  const save = async () => {
    try {
      await api(`/api/admin/orders/${encodeURIComponent(order.reference)}/status`, { method: 'PUT', body: JSON.stringify({ status, note: statusNote, internalNotes }) });
      setRowError('');
      onSaved();
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Could not save order changes.');
    }
  };
  return (
    <article className="rounded-xl border border-[#ebe5db] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><p className="font-semibold">{order.reference} · {order.customer_name}</p><p className="text-xs text-gray-500">{order.phone} · {new Date(order.created_at).toLocaleString()}</p></div>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border px-2 py-2 text-sm">{['pending', 'confirmed', 'processing', 'ready', 'completed', 'cancelled'].map((item) => <option key={item}>{item}</option>)}</select>
        <button type="button" className={secondaryButtonClass} onClick={() => void loadHistory()}>{expanded ? 'Refresh details' : 'Details / history'}</button>
      </div>
      {rowError && <p role="alert" className="mt-2 text-sm text-red-700">{rowError}</p>}
      {expanded && <div className="mt-3 rounded-lg bg-[#faf8f3] p-3 text-sm"><p>{order.delivery_location || 'No delivery location'}</p><p className="mt-1">{order.notes || 'No customer notes'}</p><ul className="mt-2 space-y-1">{order.items?.map((item: ApiRecord, index: number) => <li key={item.id ?? index}>{item.product_name} × {item.quantity}{item.price_snapshot ? ` · ${item.price_snapshot} ETB` : ''}</li>)}</ul><div className="mt-3 border-t pt-2">{history.map((item) => <p key={item.id} className="text-xs">{item.status} · {new Date(item.created_at).toLocaleString()} {item.note && `· ${item.note}`}</p>)}</div></div>}
      <label className="mt-3 block text-xs font-semibold text-gray-500">Private internal note<textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal text-[#30281d]" /></label>
      <label className="mt-3 block text-xs font-semibold text-gray-500">Status history note (visible to customer)<input value={statusNote} onChange={(event) => setStatusNote(event.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal text-[#30281d]" /></label>
      <button type="button" className={`${buttonClass} mt-2`} onClick={() => void save()}><Save size={15} /> Save status & note</button>
    </article>
  );
}

function InquiryRow({ inquiry, api, onSaved }: { inquiry: ApiRecord; api: (url: string, init?: RequestInit) => Promise<any>; onSaved: () => void }) {
  const [status, setStatus] = useState(inquiry.status);
  const [notes, setNotes] = useState(inquiry.internal_notes ?? '');
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [rowError, setRowError] = useState('');
  const save = async () => {
    try {
      await api(`/api/admin/inquiries/${encodeURIComponent(inquiry.id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      await api(`/api/admin/inquiries/${encodeURIComponent(inquiry.id)}/notes`, { method: 'PUT', body: JSON.stringify({ internalNotes: notes }) });
      setRowError('');
      onSaved();
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Could not save inquiry changes.');
    }
  };
  const retryTelegram = async () => {
    setSending(true);
    setRowError('');
    try {
      const response = await api(`/api/admin/inquiries/${encodeURIComponent(inquiry.id)}/retry-telegram`, { method: 'POST' });
      if (!response.success) throw new Error(response.error || 'Telegram notification failed.');
      onSaved();
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Telegram notification failed.');
    } finally {
      setSending(false);
    }
  };
  return (
    <article className="rounded-xl border border-[#ebe5db] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><p className="font-semibold">{inquiry.customer_name} · {inquiry.reference}</p><p className="text-xs text-gray-500">{inquiry.phone_number}{inquiry.email ? ` · ${inquiry.email}` : ''} · {new Date(inquiry.created_at).toLocaleString()}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs ${inquiry.telegram_delivery_status === 'sent' ? 'bg-green-100 text-green-800' : inquiry.telegram_delivery_status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>Telegram {inquiry.telegram_delivery_status}</span>
        <button type="button" className={secondaryButtonClass} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide message' : 'Read message'}</button>
      </div>
      {expanded && <p className="my-3 whitespace-pre-wrap rounded-lg bg-[#faf8f3] p-3 text-sm">{inquiry.message}</p>}
      {inquiry.telegram_error && <p className="mt-2 text-xs text-red-700">Telegram error: {inquiry.telegram_error}</p>}
      {rowError && <p role="alert" className="mt-2 text-sm text-red-700">{rowError}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">{['new', 'contacted', 'resolved', 'archived'].map((item) => <option key={item}>{item}</option>)}</select>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Private internal note" maxLength={2000} className="rounded-lg border px-3 py-2 text-sm" />
        <button type="button" className={buttonClass} onClick={() => void save()}><Save size={15} /> Save</button>
      </div>
      {inquiry.telegram_delivery_status !== 'sent' && <button type="button" disabled={sending} className={`${secondaryButtonClass} mt-2`} onClick={() => void retryTelegram()}>{sending ? 'Retrying…' : 'Retry Telegram notification'}</button>}
    </article>
  );
}
