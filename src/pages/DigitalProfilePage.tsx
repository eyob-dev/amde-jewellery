import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  Clock3,
  Facebook,
  Gem,
  Instagram,
  Link2,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  Music2,
  Phone,
  Send,
  Share2,
  Sun,
  X,
} from 'lucide-react';

type ThemeSetting = Record<string, string>;
type ContactLink = {
  id: string;
  label: string;
  icon: string;
  url: string | null;
  type: string;
  enabled: number;
  order_index: number;
};
type BusinessProfile = {
  name: string;
  tagline: string;
  introduction: string;
  description: string | null;
  category: string;
  location: string | null;
  address: string | null;
  opening_hours: Record<string, unknown> | string | null;
  logo: string | null;
  images: string[];
  contact_email: string | null;
  visible: number;
};
type ProductImage = { id: string; url: string; orderIndex: number };
type JewelleryProduct = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  description: string | null;
  material: string | null;
  price: string | null;
  available: number;
  featured: number;
  reference: string | null;
  images: ProductImage[];
};
type SavedItem = { itemType: 'profile' | 'product'; referenceId: string };
type ProfileSection = { id: string; title: string; description: string | null; visible: number; order_index: number };
type Modal = 'message' | 'order' | 'notebook' | 'menu' | 'track' | null;

const emptyProfile: BusinessProfile = {
  name: 'AMDE JEWELLERY',
  tagline: 'Timeless Elegance. Beautifully Crafted.',
  introduction: 'Discover the beauty of timeless elegance at AMDE JEWELLERY.',
  description: null,
  category: 'Gold & Silver Jewellery',
  location: null,
  address: null,
  opening_hours: null,
  logo: null,
  images: [],
  contact_email: null,
  visible: 1,
};

const emptyFooter = {
  footer_logo: null,
  copyright: null,
  business_description: null,
  contact_info: null,
  visible: 1,
  additional_links: [] as { label: string; url: string }[],
};

const iconByName: Record<string, typeof Phone> = {
  phone: Phone,
  call: Phone,
  whatsapp: MessageCircle,
  'message-circle': MessageCircle,
  telegram: Send,
  send: Send,
  instagram: Instagram,
  facebook: Facebook,
  tiktok: Music2,
  'map-pin': MapPin,
  location: MapPin,
  mail: Mail,
  email: Mail,
  link: Link2,
  custom: Link2,
};

const iconForLink = (link: ContactLink) => iconByName[link.icon.toLowerCase()] ?? iconByName[link.type.toLowerCase()] ?? Link2;

function hasUsefulContactDestination(link: ContactLink): boolean {
  const type = link.type.toLowerCase();
  const url = link.url?.trim() ?? '';
  if (!url || url === 'tel:') return false;
  if (['phone', 'call'].includes(type)) {
    return /^tel:\+?[0-9 ()-]{6,}$/i.test(url) && url.replace(/\D/g, '').length >= 6;
  }
  if (type === 'whatsapp') return /^https:\/\/wa\.me\/[0-9]{6,}\/?$/i.test(url);
  if (type === 'telegram') return /^https:\/\/t\.me\/[a-z0-9_]{3,}\/?$/i.test(url);
  if (['instagram', 'facebook', 'tiktok'].includes(type)) {
    try {
      return new URL(url).pathname.replaceAll('/', '').length > 0;
    } catch {
      return false;
    }
  }
  if (type === 'email') {
    return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(url) && !url.toLowerCase().endsWith('.example');
  }
  return /^https?:\/\//i.test(url) || /^(tel:|mailto:|geo:)/i.test(url);
}

function getNotebookSessionId(): string {
  const saved = localStorage.getItem('amdeNotebookSession');
  if (saved && /^[a-f0-9]{32,64}$/i.test(saved)) return saved;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const next = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('amdeNotebookSession', next);
  return next;
}

function formatOpeningHours(hours: BusinessProfile['opening_hours']): string[] {
  if (!hours) return [];
  let value: Record<string, unknown>;
  if (typeof hours === 'string') {
    try {
      value = JSON.parse(hours) as Record<string, unknown>;
    } catch {
      return [];
    }
  } else {
    value = hours;
  }
  return Object.entries(value)
    .filter(([, text]) => typeof text === 'string' && text.trim())
    .map(([day, text]) => `${day}: ${String(text)}`);
}

export default function DigitalProfilePage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [themeSettings, setThemeSettings] = useState<ThemeSetting>({});
  const [savedTheme, setSavedTheme] = useState(() => localStorage.getItem('amdeTheme'));
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([]);
  const [products, setProducts] = useState<JewelleryProduct[]>([]);
  const [profileCards, setProfileCards] = useState<JewelleryProduct[]>([]);
  const [profileSections, setProfileSections] = useState<ProfileSection[]>([]);
  const [footer, setFooter] = useState(emptyFooter);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<JewelleryProduct | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [savingItem, setSavingItem] = useState('');
  const [notice, setNotice] = useState('');
  const [messageForm, setMessageForm] = useState({ customerName: '', phoneNumber: '', email: '', message: '', website: '' });
  const [messageErrors, setMessageErrors] = useState<Record<string, string>>({});
  const [messageSending, setMessageSending] = useState(false);
  const [messageResult, setMessageResult] = useState('');
  const [orderItems, setOrderItems] = useState<Record<string, number>>({});
  const [orderForm, setOrderForm] = useState({ customerName: '', phone: '', deliveryLocation: '', notes: '' });
  const [orderSending, setOrderSending] = useState(false);
  const [orderResult, setOrderResult] = useState('');
  const [trackForm, setTrackForm] = useState({ reference: '', phone: '' });
  const [trackResult, setTrackResult] = useState('');
  const [trackInfo, setTrackInfo] = useState<{ statusHistory?: { status: string; note: string | null; created_at: string }[] } | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [logoTapTimes, setLogoTapTimes] = useState<number[]>([]);

  const refreshNotebook = useCallback(async (id: string) => {
    const response = await fetch(`/api/notebook?sessionId=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Unable to load your notebook.');
    const data = await response.json() as SavedItem[];
    setSavedItems(Array.isArray(data) ? data : []);
  }, []);

  const loadProfileData = useCallback(async () => {
    setDataLoading(true);
    setLoadError('');
    try {
    const currentSession = getNotebookSessionId();
    const responses = await Promise.all([
      fetch('/api/business-profile'),
      fetch('/api/theme-settings'),
      fetch('/api/contact-links'),
      fetch('/api/products'),
      fetch('/api/products?profileCards=true'),
      fetch('/api/profile-sections'),
      fetch('/api/footer-settings'),
      fetch(`/api/notebook?sessionId=${encodeURIComponent(currentSession)}`),
      ]);
      if (responses[0].status === 404) {
        setProfile({ ...emptyProfile, visible: 0 });
        return;
      }
      const failed = responses.find((response) => !response.ok);
      if (failed) throw new Error(`Profile data could not be loaded (HTTP ${failed.status}).`);
      const [profileData, themeData, linksData, productsData, profileCardsData, sectionData, footerData, notebookData] = await Promise.all(
        responses.map((response) => response.json())
      ) as [BusinessProfile, ThemeSetting, ContactLink[], JewelleryProduct[], JewelleryProduct[], ProfileSection[], typeof footer, SavedItem[]];
      setProfile({ ...emptyProfile, ...profileData });
      setThemeSettings(themeData);
      setContactLinks(Array.isArray(linksData) ? linksData.filter((link) => link.enabled && link.url) : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
      const cards = Array.isArray(profileCardsData) ? profileCardsData.slice(0, 5) : [];
      setProfileCards(cards);
      setProfileSections(Array.isArray(sectionData) ? sectionData : []);
      setFooter({ ...emptyFooter, ...footerData });
      setSavedItems(Array.isArray(notebookData) ? notebookData : []);
      setSessionId(currentSession);
      if (!localStorage.getItem('amdeTheme')) {
        setSavedTheme(themeData.default_theme === 'golden-black' ? 'golden-black' : 'creamy-golden');
      }
    } catch (error) {
      console.error('Failed to load business profile:', error);
      setLoadError(error instanceof Error ? error.message : 'Business profile is temporarily unavailable.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfileData();
  }, [loadProfileData]);

  const dark = (savedTheme ?? themeSettings.default_theme) === 'golden-black';
  const palette = useMemo(() => {
    const prefix = dark ? 'gb' : 'cg';
    const defaults = dark
      ? { background: '#0B0B0B', surface: '#171717', secondary: '#1C1B19', gold: '#D4AF37', gold2: '#C6A15B', text: '#F5F0E6', muted: '#AFA99C' }
      : { background: '#FCFAF5', surface: '#F4EFE4', secondary: '#FFFFFF', gold: '#B99548', gold2: '#D7C29A', text: '#251F18', muted: '#81776A' };
    return {
      background: themeSettings[`${prefix}_background`] || defaults.background,
      surface: themeSettings[`${prefix}_surface`] || defaults.surface,
      secondary: themeSettings[`${prefix}_surface_secondary`] || defaults.secondary,
      gold: themeSettings[`${prefix}_primary_gold`] || defaults.gold,
      gold2: themeSettings[`${prefix}_secondary_gold`] || defaults.gold2,
      text: themeSettings[`${prefix}_primary_text`] || defaults.text,
      muted: themeSettings[`${prefix}_muted_text`] || defaults.muted,
    };
  }, [dark, themeSettings]);
  const theme = {
    page: dark ? 'bg-[#0b0b0b]' : 'bg-[#fcfaf5]',
    card: dark ? 'bg-[#171717]' : 'bg-white',
    surface: dark ? 'bg-[#1c1b19]' : 'bg-[#f4efe4]',
    text: dark ? 'text-[#f5f0e6]' : 'text-[#251f18]',
    muted: dark ? 'text-[#afa99c]' : 'text-[#81776a]',
  };
  const profileSaved = savedItems.some((item) => item.itemType === 'profile' && item.referenceId === 'single');
  const openingHours = formatOpeningHours(profile.opening_hours);
  const sectionIsVisible = (id: string) => {
    const section = profileSections.find((item) => item.id === id);
    return !section || Boolean(section.visible);
  };
  const sectionTitle = (id: string, fallback: string) => {
    const title = profileSections.find((item) => item.id === id)?.title;
    if (id === 's-actions' && title === 'Contact Actions') return fallback;
    if (id === 's-collection' && title?.toLowerCase() === 'jewellery collection') return fallback;
    return title || fallback;
  };
  const sectionDescription = (id: string) =>
    profileSections.find((item) => item.id === id)?.description;
  const sectionOrder = (id: string, fallback: number) =>
    profileSections.find((item) => item.id === id)?.order_index ?? fallback;
  const locationLink = contactLinks.find((link) => link.type.toLowerCase() === 'location');
  const configuredLocationLink = locationLink?.url && !/^https?:\/\/(maps\.google\.com|www\.google\.com)\/?$/i.test(locationLink.url)
    ? locationLink.url
    : null;
  const phoneLink = contactLinks.find((link) =>
    (['phone', 'call'].includes(link.type.toLowerCase()) || Boolean(link.url?.startsWith('tel:'))) &&
    hasUsefulContactDestination(link)
  );
  const visibleContactLinks = contactLinks
    .filter((link) => link.type.toLowerCase() !== 'location' && hasUsefulContactDestination(link))
    .concat(profile.contact_email && !profile.contact_email.toLowerCase().endsWith('.example') && !contactLinks.some((link) => link.type.toLowerCase() === 'email')
      ? [{ id: 'profile-email', label: 'Email', icon: 'mail', url: `mailto:${profile.contact_email}`, type: 'email', enabled: 1, order_index: 999 }]
      : []);
  const socialContactLinks = contactLinks
    .filter((link) => ['whatsapp', 'telegram', 'instagram', 'facebook', 'tiktok'].includes(link.type.toLowerCase()))
    .sort((left, right) => left.order_index - right.order_index);
  const socialLinks = socialContactLinks.length > 0
    ? socialContactLinks
    : visibleContactLinks.filter((link) => !['phone', 'call', 'location'].includes(link.type.toLowerCase()));
  const savedProducts = products.filter((product) =>
    savedItems.some((item) => item.itemType === 'product' && item.referenceId === product.id)
  );
  const savedLink = (link: ContactLink) =>
    link.url ?? '#';
  const isExternal = (url: string) => /^https?:\/\//i.test(url);

  const toggleTheme = () => {
    const next = dark ? 'creamy-golden' : 'golden-black';
    setSavedTheme(next);
    localStorage.setItem('amdeTheme', next);
  };

  const updateNotebook = async (itemType: 'profile' | 'product', referenceId: string) => {
    if (!sessionId || savingItem) return;
    const exists = savedItems.some((item) => item.itemType === itemType && item.referenceId === referenceId);
    setSavingItem(`${itemType}:${referenceId}`);
    setNotice('');
    try {
      const response = await fetch(
        exists
          ? `/api/notebook/${itemType}/${encodeURIComponent(referenceId)}?sessionId=${encodeURIComponent(sessionId)}`
          : '/api/notebook',
        exists
          ? { method: 'DELETE' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId, itemType, referenceId }),
            }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update your notebook.');
      await refreshNotebook(sessionId);
      setNotice(exists ? 'Removed from your notebook.' : 'Saved to your notebook.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update your notebook.');
    } finally {
      setSavingItem('');
    }
  };

  const clearNotebook = async () => {
    if (!sessionId || !window.confirm('Remove all saved items from your notebook?')) return;
    try {
      const response = await fetch(`/api/notebook?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not clear notebook.');
      setSavedItems([]);
      setNotice('Notebook cleared.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not clear notebook.');
    }
  };

  const submitMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (messageSending) return;
    setMessageSending(true);
    setMessageErrors({});
    setMessageResult('');
    try {
      const response = await fetch('/api/contact/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageForm),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.fields) setMessageErrors(result.fields as Record<string, string>);
        else setMessageResult(result.error || 'Message could not be sent.');
        return;
      }
      setMessageResult(result.message);
      setMessageForm({ customerName: '', phoneNumber: '', email: '', message: '', website: '' });
    } catch (error) {
      setMessageResult(error instanceof Error ? error.message : 'Network error while sending your message.');
    } finally {
      setMessageSending(false);
    }
  };

  const submitOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (orderSending) return;
    const items = Object.entries(orderItems).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
    setOrderSending(true);
    setOrderResult('');
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderForm, items }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your order inquiry could not be saved.');
      setOrderResult(`${data.message} Reference: ${data.reference}`);
      setOrderItems({});
      setOrderForm({ customerName: '', phone: '', deliveryLocation: '', notes: '' });
    } catch (error) {
      setOrderResult(error instanceof Error ? error.message : 'Network error while submitting your order.');
    } finally {
      setOrderSending(false);
    }
  };

  const submitTracking = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trackLoading) return;
    setTrackLoading(true);
    setTrackResult('');
    setTrackInfo(null);
    try {
      const query = new URLSearchParams(trackForm);
      const response = await fetch(`/api/orders?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Order could not be found.');
      setTrackResult(`Order ${data.reference}: ${data.status}.`);
      setTrackInfo(data);
    } catch (error) {
      setTrackResult(error instanceof Error ? error.message : 'Could not check the order.');
    } finally {
      setTrackLoading(false);
    }
  };

  const shareProfile = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: profile.name, text: profile.tagline, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setNotice('Profile link copied.');
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setNotice('Could not share the profile link.');
    }
  };

  const tapFooterLogo = () => {
    const now = Date.now();
    const taps = [...logoTapTimes.filter((time) => now - time <= 5000), now];
    setLogoTapTimes(taps);
    if (taps.length >= 5) {
      window.location.assign('/admin');
    }
  };

  const addToOrder = (product: JewelleryProduct) => {
    if (!product.available) {
      setNotice('This piece is currently unavailable.');
      return;
    }
    setOrderItems((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
    setNotice(`${product.name} added to My Order.`);
  };

  const closeModal = () => {
    setModal(null);
    setMessageResult('');
    setTrackResult('');
    setTrackInfo(null);
  };

  return (
    <div
      className={`min-h-screen px-4 py-5 transition-colors duration-300 sm:py-8 ${theme.page}`}
      style={{
        backgroundColor: palette.background,
        color: palette.text,
        fontFamily: `"${themeSettings.body_font || 'Montserrat'}", sans-serif`,
        ['--font-serif' as string]: `"${themeSettings.heading_font || 'Cormorant Garamond'}", serif`,
        ['--font-sans' as string]: `"${themeSettings.body_font || 'Montserrat'}", sans-serif`,
      }}
    >
      <div className={`mx-auto max-w-[720px] overflow-hidden rounded-[30px] border shadow-[0_20px_60px_rgba(47,37,20,0.12)] ${dark ? 'border-[#c6a15b]/30' : 'border-[#b99548]/30'} ${theme.card}`} style={{ backgroundColor: palette.secondary }}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 backdrop-blur-md sm:py-4" style={{ backgroundColor: `${palette.surface}ee`, borderColor: `${palette.gold2}66` }}>
          <div className="flex min-w-0 items-center gap-3">
            {profile.logo ? (
              <img src={profile.logo} alt={`${profile.name} logo`} className="h-10 w-10 rounded-full border object-cover sm:h-14 sm:w-14" style={{ borderColor: palette.gold2 }} />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border font-serif text-lg sm:h-14 sm:w-14 sm:text-2xl" style={{ borderColor: palette.gold2, color: palette.gold, backgroundColor: palette.secondary }}>
                {profile.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className={`truncate font-serif text-xl font-semibold sm:text-2xl ${theme.text}`}>{profile.name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={toggleTheme} aria-label={`Switch to ${dark ? 'creamy golden' : 'golden black'} theme`} className={`flex h-10 w-10 items-center justify-center rounded-full border sm:h-14 sm:w-14 ${theme.card} ${theme.text}`} style={{ borderColor: `${palette.gold2}77` }}>
              {dark ? <Sun size={18} className="sm:h-[21px] sm:w-[21px]" /> : <Moon size={18} className="sm:h-[21px] sm:w-[21px]" />}
            </button>
            <button type="button" onClick={() => void shareProfile()} aria-label="Share profile" className={`flex h-10 w-10 items-center justify-center rounded-full border sm:h-14 sm:w-14 ${theme.card} ${theme.text}`} style={{ borderColor: `${palette.gold2}77` }}>
              <Share2 size={18} className="sm:h-[21px] sm:w-[21px]" />
            </button>
            <button type="button" onClick={() => setModal('menu')} aria-label="Open menu" className={`flex h-10 w-10 items-center justify-center rounded-full border sm:h-14 sm:w-14 ${theme.card} ${theme.text}`} style={{ borderColor: `${palette.gold2}77` }}>
              <Menu size={18} className="sm:h-[21px] sm:w-[21px]" />
            </button>
          </div>
        </header>

        {loadError && (
          <div role="alert" className="mx-4 mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
            <button type="button" onClick={() => void loadProfileData()} className="ml-2 underline">Retry</button>
          </div>
        )}
        {profile.visible === 0 ? (
          <div className={`p-8 text-center ${theme.text}`}>This business profile is temporarily unavailable.</div>
        ) : (
          <main className="flex flex-col px-4 pb-6 sm:px-8 sm:pb-8">
            <section hidden={!sectionIsVisible('s-profile')} style={{ order: sectionOrder('s-profile', 0) }} className="pt-7 text-center">
              <div className="mx-auto flex h-60 w-60 items-center justify-center overflow-hidden rounded-full border-[3px] p-2 shadow-[0_12px_30px_rgba(160,123,48,0.18)]" style={{ backgroundColor: palette.secondary, borderColor: palette.gold2 }}>
                {profile.logo ? (
                  <img src={profile.logo} alt={`${profile.name} logo`} className="h-full w-full rounded-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full border font-serif text-8xl" style={{ borderColor: `${palette.gold2}99`, color: palette.gold }}>
                    {profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                  </div>
                )}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <h1 className={`font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-[3.5rem] ${theme.text}`}>
                  {profile.name}
                </h1>
                <Check className="h-6 w-6 shrink-0 rounded-full p-1 text-white" style={{ backgroundColor: palette.gold }} aria-label="Verified business profile" />
              </div>
              <p className="mt-3 text-sm font-semibold" style={{ color: palette.gold }}>{profile.category}</p>
              <p className={`mx-auto mt-4 max-w-sm font-serif text-xl leading-relaxed ${theme.text}`}>{profile.tagline}</p>
              {(profile.description || profile.introduction) && (
                <p className={`mx-auto mt-2 max-w-sm text-sm leading-6 ${theme.muted}`}>{profile.description || profile.introduction}</p>
              )}
              {(profile.location || profile.address) && (
                <a
                  href={configuredLocationLink || `https://maps.google.com/?q=${encodeURIComponent(profile.address || profile.location || '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`mx-auto mt-5 inline-flex max-w-full items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm ${theme.text}`}
                  style={{ backgroundColor: palette.surface, borderColor: `${palette.gold2}66` }}
                >
                  <MapPin size={16} className="shrink-0" style={{ color: palette.gold }} />
                  <span className="truncate">{profile.address || profile.location}</span>
                </a>
              )}
              {openingHours.length > 0 && (
                <details className="mx-auto mt-3 max-w-sm text-left">
                  <summary className={`flex cursor-pointer items-center justify-center gap-2 text-xs ${theme.muted}`}>
                    <Clock3 size={14} /> Opening hours
                  </summary>
                  <ul className={`mt-2 space-y-1 rounded-xl p-3 text-xs ${theme.muted}`} style={{ backgroundColor: palette.surface }}>
                    {openingHours.map((hour) => <li key={hour}>{hour}</li>)}
                  </ul>
                </details>
              )}
            </section>

            <section hidden={!sectionIsVisible('s-actions')} style={{ order: sectionOrder('s-actions', 1) }} className="mt-7" aria-label="Social links and notebook">
              <div className="flex flex-wrap justify-center gap-3">
                {socialLinks.map((link, index) => {
                  const Icon = iconForLink(link);
                  const tones = ['#c5a15b', '#479e80', '#4b98c4', '#bd7197', '#5a5865', '#a88d60'];
                  const url = savedLink(link);
                  const className = 'flex h-16 w-16 items-center justify-center rounded-full text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
                  const style = { backgroundColor: tones[index % tones.length] };
                  return hasUsefulContactDestination(link) ? (
                    <a
                      key={link.id}
                      href={url}
                      target={isExternal(url) ? '_blank' : undefined}
                      rel={isExternal(url) ? 'noreferrer' : undefined}
                      aria-label={link.label}
                      title={link.label}
                      className={className}
                      style={style}
                    >
                      <Icon size={27} />
                    </a>
                  ) : (
                    <span
                      key={link.id}
                      role="img"
                      aria-label={`${link.label} link not configured`}
                      title={`${link.label} link not configured`}
                      className={`${className} cursor-not-allowed opacity-45`}
                      style={style}
                    >
                      <Icon size={27} />
                    </span>
                  );
                })}
              </div>
              <div className="mx-auto mt-4 max-w-md space-y-2 border-b pb-5" style={{ borderColor: `${palette.gold2}55` }}>
                <button type="button" disabled={!sessionId || Boolean(savingItem)} onClick={() => void updateNotebook('profile', 'single')} aria-pressed={profileSaved} className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60 ${theme.text}`} style={{ backgroundColor: palette.surface, borderColor: `${palette.gold2}77` }}>
                  {profileSaved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                  {profileSaved ? 'Saved to notebook' : 'Save profile to notebook'}
                </button>
                <button type="button" onClick={() => setModal('notebook')} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${theme.muted}`}>
                  <Bookmark size={16} /> My notebook ({savedItems.length})
                </button>
              </div>
              {sectionDescription('s-actions') && <p className={`mt-3 text-center text-xs ${theme.muted}`}>{sectionDescription('s-actions')}</p>}
            </section>

            {profile.images.length > 0 && (
              <div hidden={!sectionIsVisible('s-profile')} style={{ order: sectionOrder('s-profile', 0) }} className="mt-5 flex snap-x gap-3 overflow-x-auto pb-2" aria-label="Business profile images">
                {profile.images.map((image, index) => (
                  <img key={`${image}-${index}`} src={image} alt={`${profile.name} ${index + 1}`} className="h-40 w-4/5 shrink-0 snap-center rounded-2xl object-cover" />
                ))}
              </div>
            )}

            <section hidden={!sectionIsVisible('s-profile')} style={{ borderColor: `${palette.gold2}55`, order: sectionOrder('s-profile', 0) }} className="mt-7 border-y py-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { value: profile.category.replace(/\s+Jewellery$/i, '') || 'Jewellery', label: 'Our specialty' },
                  { value: 'Handcrafted', label: 'Made with care' },
                  { value: (profile.location || profile.address || 'Addis Ababa').split(',')[0], label: 'Our home' },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="font-serif text-lg font-semibold leading-tight sm:text-2xl" style={{ color: palette.gold }}>{stat.value}</div>
                    <div className={`mt-2 text-xs ${theme.muted}`}>{stat.label}</div>
                  </div>
                ))}
              </div>
            </section>

            <section hidden={!sectionIsVisible('s-actions')} style={{ order: sectionOrder('s-actions', 1) }} className="mt-6 space-y-3">
              {sectionIsVisible('s-collection') && (
                <a href="#featured-jewellery" className="flex min-h-20 w-full items-center justify-center gap-3 rounded-full px-5 py-6 text-lg font-semibold shadow-[0_10px_20px_rgba(0,0,0,0.08)] transition hover:brightness-105" style={{ backgroundColor: palette.gold, color: dark ? '#111111' : '#fffaf0' }}>
                  <Gem size={18} /> Explore jewellery <ChevronRight size={18} />
                </a>
              )}
              {phoneLink && (
                <a href={phoneLink.url ?? '#'} className={`flex min-h-20 w-full items-center justify-center gap-3 rounded-full border px-5 py-6 text-lg font-semibold ${theme.text}`} style={{ backgroundColor: palette.secondary, borderColor: `${palette.gold2}77` }}>
                  <Phone size={18} /> Call the atelier
                </a>
              )}
              {!phoneLink && (
                <button type="button" onClick={() => setModal('message')} className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-full border px-5 py-5 text-base font-semibold ${theme.text}`} style={{ backgroundColor: palette.secondary, borderColor: `${palette.gold2}77` }}>
                  <MessageCircle size={18} /> Message the atelier
                </button>
              )}
            </section>
            {notice && <p role="status" className={`mt-3 text-center text-xs ${theme.muted}`}>{notice}</p>}

            <section hidden={!sectionIsVisible('s-collection')} style={{ order: sectionOrder('s-collection', 2) }} id="featured-jewellery" className="mt-8 scroll-mt-24">
              <div className="mb-4 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em]" style={{ color: palette.gold }}>AMDE collection</p>
                <h2 className={`mt-1 font-serif text-2xl ${theme.text}`}>{sectionTitle('s-collection', 'Jewellery highlights')}</h2>
                {sectionDescription('s-collection') && <p className={`mx-auto mt-2 max-w-sm text-sm ${theme.muted}`}>{sectionDescription('s-collection')}</p>}
              </div>
              {dataLoading ? (
                <p className={`py-8 text-center text-sm ${theme.muted}`}>Loading jewellery highlights…</p>
              ) : profileCards.length === 0 ? (
                <div className={`rounded-2xl border px-5 py-7 text-center ${theme.muted}`} style={{ borderColor: `${palette.gold2}66`, backgroundColor: palette.surface }}>
                  <Gem size={24} className="mx-auto mb-2" style={{ color: palette.gold }} />
                  <p className={`font-serif text-lg ${theme.text}`}>A few beautiful pieces, coming soon</p>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-6">Save our profile and check back to see the jewellery highlights.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {profileCards.map((product) => {
                    const image = product.images?.[0]?.url;
                    const isSaved = savedItems.some((item) => item.itemType === 'product' && item.referenceId === product.id);
                    return (
                      <article key={product.id} className={`overflow-hidden rounded-2xl border shadow-sm ${theme.card}`} style={{ borderColor: `${palette.gold2}66`, backgroundColor: palette.secondary }}>
                        <button type="button" onClick={() => setSelectedProduct(product)} className="block w-full text-left">
                          <div className="aspect-[1.55/1] overflow-hidden" style={{ backgroundColor: palette.surface }}>
                            {image ? <img src={image} alt={product.name} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center" style={{ color: palette.gold }}><Gem size={42} /></div>}
                          </div>
                          <div className="p-4">
                            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em]" style={{ color: palette.gold }}>{product.category_name}</p>
                            <h3 className={`mt-1 font-serif text-xl ${theme.text}`}>{product.name}</h3>
                            <p className="mt-2 text-sm font-semibold" style={{ color: palette.gold }}>
                              {product.material || 'Carat / material to be confirmed'}
                            </p>
                            <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${theme.muted}`}>{product.description || 'Introduction coming soon.'}</p>
                          </div>
                        </button>
                        <div className="px-4 pb-4">
                          <button type="button" aria-pressed={isSaved} disabled={Boolean(savingItem)} onClick={() => void updateNotebook('product', product.id)} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-full border text-sm font-semibold disabled:opacity-60 ${theme.text}`} style={{ borderColor: palette.gold2 }}>
                            {isSaved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
                            {isSaved ? 'Saved to notebook' : 'Save to notebook'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <footer hidden={!sectionIsVisible('s-footer')} className={`mt-8 border-t pt-5 text-center ${theme.muted}`} style={{ borderColor: `${palette.gold2}55`, order: sectionOrder('s-footer', 3) }}>
              {footer.visible !== 0 && (
                <>
                  {footer.footer_logo && <img src={footer.footer_logo} alt={`${profile.name} footer logo`} className="mx-auto mb-2 h-9 w-9 rounded-full object-cover" />}
                  {footer.business_description && <p className="mx-auto max-w-sm text-xs leading-5">{footer.business_description}</p>}
                  {footer.contact_info && <p className="mx-auto mt-2 max-w-sm whitespace-pre-line text-xs leading-5">{footer.contact_info}</p>}
                  {footer.additional_links?.length > 0 && <div className="mt-3 flex flex-wrap justify-center gap-3">{footer.additional_links.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} className="text-xs underline underline-offset-2">{link.label}</a>)}</div>}
                  <p className="mt-3 text-[0.65rem]">{footer.copyright || `© ${new Date().getFullYear()} ${profile.name}. All rights reserved.`}</p>
                </>
              )}
              <button type="button" onClick={tapFooterLogo} aria-label="Business logo" className="mx-auto mt-4 flex h-8 w-8 items-center justify-center rounded-full border font-serif text-xs" style={{ borderColor: `${palette.gold2}77`, color: palette.gold }}>
                {footer.footer_logo ? <img src={footer.footer_logo} alt="" className="h-full w-full rounded-full object-cover" /> : profile.name.slice(0, 1)}
              </button>
            </footer>
            {!sectionIsVisible('s-footer') && (
              <button type="button" onClick={tapFooterLogo} aria-label="Business logo" className="mx-auto mt-4 flex h-8 w-8 items-center justify-center rounded-full border font-serif text-xs" style={{ borderColor: `${palette.gold2}77`, color: palette.gold }}>
                {profile.name.slice(0, 1)}
              </button>
            )}
          </main>
        )}
      </div>

      {selectedProduct && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="product-dialog-title" className={`max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl ${theme.card}`} style={{ backgroundColor: palette.secondary }}>
            <div className="flex justify-end"><button type="button" onClick={() => setSelectedProduct(null)} aria-label="Close product details" className={`rounded-full p-2 ${theme.text}`}><X size={20} /></button></div>
            {selectedProduct.images?.[0]?.url && <img src={selectedProduct.images[0].url} alt={selectedProduct.name} className="max-h-64 w-full rounded-2xl object-cover" />}
            <p className="mt-4 text-xs font-semibold uppercase tracking-widest" style={{ color: palette.gold }}>{selectedProduct.category_name}</p>
            <h2 id="product-dialog-title" className={`mt-1 font-serif text-3xl ${theme.text}`}>{selectedProduct.name}</h2>
            <p className="mt-2 text-sm font-semibold" style={{ color: palette.gold }}>{selectedProduct.material || 'Carat / material to be confirmed'}</p>
            <p className={`mt-3 whitespace-pre-line text-sm leading-6 ${theme.muted}`}>{selectedProduct.description || 'Introduction coming soon.'}</p>
            <div className="mt-5">
              <button type="button" disabled={Boolean(savingItem)} onClick={() => void updateNotebook('product', selectedProduct.id)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border text-sm font-semibold disabled:opacity-60" style={{ borderColor: palette.gold2, color: palette.gold }}>
                {savedItems.some((item) => item.itemType === 'product' && item.referenceId === selectedProduct.id) ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
                {savedItems.some((item) => item.itemType === 'product' && item.referenceId === selectedProduct.id) ? 'Saved to notebook' : 'Save to notebook'}
              </button>
            </div>
          </section>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="modal-heading" className={`max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl ${theme.card}`} style={{ backgroundColor: palette.secondary }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 id="modal-heading" className={`font-serif text-2xl ${theme.text}`}>
                {modal === 'message' ? "We'd Love to Hear From You" : modal === 'order' ? 'My Order' : modal === 'notebook' ? 'My Notebook' : modal === 'menu' ? profile.name : 'Track your order'}
              </h2>
              <button type="button" onClick={closeModal} aria-label="Close" className={`rounded-full p-2 ${theme.text}`}><X size={20} /></button>
            </div>

            {modal === 'message' && (
              <>
                <p className={`mb-4 text-sm leading-6 ${theme.muted}`}>Have a question about our jewellery collection, product availability, or a special request? Send us a message. Our team will be happy to assist you.</p>
                {messageResult && <p role="status" className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{messageResult}</p>}
                <form onSubmit={submitMessage} className="space-y-3">
                  <input type="text" name="website" value={messageForm.website} onChange={(event) => setMessageForm({ ...messageForm, website: event.target.value })} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[10000px] h-px w-px opacity-0" />
                  {([
                    ['customerName', 'Customer name', 'text', 'Enter your full name.'],
                    ['phoneNumber', 'Phone number', 'tel', 'Enter your phone number.'],
                    ['email', 'Email address (optional)', 'email', 'Enter your email address (optional).'],
                  ] as const).map(([key, label, type, placeholder]) => (
                    <label key={key} className={`block text-sm ${theme.text}`}>{label}
                      <input type={type} required={key !== 'email'} maxLength={key === 'customerName' ? 100 : 200} value={messageForm[key]} onChange={(event) => setMessageForm({ ...messageForm, [key]: event.target.value })} placeholder={placeholder} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-3 outline-none focus:ring-2" style={{ borderColor: `${palette.gold2}99`, ['--tw-ring-color' as string]: palette.gold }} />
                      {messageErrors[key] && <span className="mt-1 block text-xs text-red-600">{messageErrors[key]}</span>}
                    </label>
                  ))}
                  <label className={`block text-sm ${theme.text}`}>Your message
                    <textarea required minLength={5} maxLength={2000} rows={4} value={messageForm.message} onChange={(event) => setMessageForm({ ...messageForm, message: event.target.value })} placeholder="Write your message here..." className="mt-1 w-full resize-y rounded-xl border bg-transparent px-3 py-3 outline-none focus:ring-2" style={{ borderColor: `${palette.gold2}99`, ['--tw-ring-color' as string]: palette.gold }} />
                    {messageErrors.message && <span className="mt-1 block text-xs text-red-600">{messageErrors.message}</span>}
                    <span className={`mt-1 block text-right text-xs ${theme.muted}`}>{messageForm.message.length}/2000</span>
                  </label>
                  <button type="submit" disabled={messageSending} className="w-full rounded-full px-4 py-3 font-semibold disabled:opacity-60" style={{ backgroundColor: palette.gold, color: dark ? '#111' : '#fff' }}>{messageSending ? 'Sending…' : 'Send message'}</button>
                </form>
              </>
            )}

            {modal === 'order' && (
              <>
                {orderResult && <p role="status" className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{orderResult}</p>}
                {Object.keys(orderItems).length > 0 ? (
                  <div className="mb-4 space-y-2">
                    {Object.entries(orderItems).map(([id, quantity]) => {
                      const product = products.find((item) => item.id === id);
                      if (!product) return null;
                      return <div key={id} className={`flex items-center justify-between gap-2 rounded-xl p-3 ${theme.surface}`}>
                        <span className={`min-w-0 truncate text-sm ${theme.text}`}>{product.name}{product.price ? ` · ${product.price} ETB` : ''}</span>
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={() => setOrderItems((current) => { const next = { ...current, [id]: Math.max(0, current[id] - 1) }; if (!next[id]) delete next[id]; return next; })} className={`flex h-8 w-8 items-center justify-center rounded-full border ${theme.text}`} style={{ borderColor: palette.gold2 }}>−</button>
                          <span className={theme.text}>{quantity}</span>
                          <button type="button" aria-label={`Increase ${product.name} quantity`} onClick={() => setOrderItems((current) => ({ ...current, [id]: Math.min(99, current[id] + 1) }))} className={`flex h-8 w-8 items-center justify-center rounded-full border ${theme.text}`} style={{ borderColor: palette.gold2 }}>+</button>
                        </div>
                      </div>;
                    })}
                  </div>
                ) : <p className={`mb-4 text-sm ${theme.muted}`}>Add jewellery from the collection before submitting your inquiry.</p>}
                <form onSubmit={submitOrder} className="space-y-3">
                  {([
                    ['customerName', 'Your name', 'text'],
                    ['phone', 'Phone number', 'tel'],
                    ['deliveryLocation', 'Delivery location (optional)', 'text'],
                  ] as const).map(([key, label, type]) => <label key={key} className={`block text-sm ${theme.text}`}>{label}<input required={key !== 'deliveryLocation'} type={type} value={orderForm[key]} onChange={(event) => setOrderForm({ ...orderForm, [key]: event.target.value })} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-3" style={{ borderColor: `${palette.gold2}99` }} /></label>)}
                  <label className={`block text-sm ${theme.text}`}>Notes (optional)<textarea rows={2} maxLength={1000} value={orderForm.notes} onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-3" style={{ borderColor: `${palette.gold2}99` }} /></label>
                  <button type="submit" disabled={orderSending || Object.keys(orderItems).length === 0} className="w-full rounded-full px-4 py-3 font-semibold disabled:opacity-50" style={{ backgroundColor: palette.gold, color: dark ? '#111' : '#fff' }}>{orderSending ? 'Submitting…' : 'Submit order inquiry'}</button>
                </form>
              </>
            )}

            {modal === 'notebook' && (
              <div className="space-y-3">
                <button type="button" onClick={() => void updateNotebook('profile', 'single')} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${theme.text}`} style={{ borderColor: palette.gold2 }}>
                  {profileSaved ? <BookmarkCheck size={18} style={{ color: palette.gold }} /> : <Bookmark size={18} style={{ color: palette.gold }} />}
                  <span className="flex-1">{profile.name} profile</span>
                  {profileSaved && <Check size={16} />}
                </button>
                {savedProducts.map((product) => (
                  <div key={product.id} className={`flex items-center gap-3 rounded-xl p-3 ${theme.surface}`}>
                    {product.images?.[0]?.url && <img src={product.images[0].url} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                    <span className={`flex-1 truncate text-sm ${theme.text}`}>{product.name}</span>
                    <button type="button" onClick={() => void updateNotebook('product', product.id)} aria-label={`Remove ${product.name} from notebook`} className="rounded-full p-2 text-red-500"><X size={17} /></button>
                  </div>
                ))}
                {savedItems.length > 0 && <button type="button" onClick={() => void clearNotebook()} className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600">Clear notebook</button>}
                {savedItems.length === 0 && <p className={`py-4 text-center text-sm ${theme.muted}`}>Your notebook is empty. Save a piece or this profile to keep it here.</p>}
                {notice && <p role="status" className={`text-center text-xs ${theme.muted}`}>{notice}</p>}
              </div>
            )}

            {modal === 'menu' && (
              <div className="space-y-2">
                {sectionIsVisible('s-collection') && <button type="button" onClick={() => { closeModal(); document.getElementById('featured-jewellery')?.scrollIntoView({ behavior: 'smooth' }); }} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${theme.text}`}><Gem size={18} style={{ color: palette.gold }} /> Jewellery highlights</button>}
                <button type="button" onClick={() => setModal('notebook')} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${theme.text}`}><Bookmark size={18} style={{ color: palette.gold }} /> My Notebook ({savedItems.length})</button>
                <button type="button" onClick={() => void shareProfile()} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${theme.text}`}><Share2 size={18} style={{ color: palette.gold }} /> Share profile</button>
              </div>
            )}

            {modal === 'track' && (
              <>
                <form onSubmit={submitTracking} className="space-y-3">
                  <label className={`block text-sm ${theme.text}`}>Order reference<input required value={trackForm.reference} onChange={(event) => setTrackForm({ ...trackForm, reference: event.target.value })} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-3" style={{ borderColor: `${palette.gold2}99` }} /></label>
                  <label className={`block text-sm ${theme.text}`}>Phone number<input required type="tel" value={trackForm.phone} onChange={(event) => setTrackForm({ ...trackForm, phone: event.target.value })} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-3" style={{ borderColor: `${palette.gold2}99` }} /></label>
                  {trackResult && <p role="status" className={`text-sm ${theme.muted}`}>{trackResult}</p>}
                  {trackInfo?.statusHistory && trackInfo.statusHistory.length > 0 && (
                    <ol className={`space-y-2 border-l-2 pl-3 text-xs ${theme.muted}`} style={{ borderColor: palette.gold2 }}>
                      {trackInfo.statusHistory.map((entry, index) => <li key={`${entry.created_at}-${index}`}>{entry.status} · {new Date(entry.created_at).toLocaleString()}{entry.note ? ` · ${entry.note}` : ''}</li>)}
                    </ol>
                  )}
                  <button type="submit" disabled={trackLoading} className="w-full rounded-full px-4 py-3 font-semibold disabled:opacity-60" style={{ backgroundColor: palette.gold, color: dark ? '#111' : '#fff' }}>{trackLoading ? 'Checking…' : 'Check order status'}</button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
