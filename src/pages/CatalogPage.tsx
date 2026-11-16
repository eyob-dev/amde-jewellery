import { useEffect, useMemo, useState } from 'react';
import {
  BookmarkCheck,
  BookHeart,
  Check,
  ChevronRight,
  Facebook,
  Instagram,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  Music2,
  Phone,
  Send,
  Share2,
  Sparkles,
} from 'lucide-react';

interface ProfileJewelleryCard {
  id: string;
  name: string;
  description: string | null;
  material: string | null;
  images: { id: string; url: string; orderIndex: number }[];
}

const stats = [
  { label: 'Small', value: '24' },
  { label: 'Signature scents', value: '24' },
  { label: 'Hand finished', value: '100%' },
];

const socialLinks = [
  { label: 'Call', href: 'tel:+251911234567', icon: Phone, tone: 'bg-[#d0a85a]' },
  { label: 'WhatsApp', href: 'https://wa.me/251911234567', icon: MessageCircle, tone: 'bg-[#57b6a5]' },
  { label: 'Telegram', href: 'https://t.me/amdejewellery', icon: Send, tone: 'bg-[#5e9fe7]' },
  { label: 'Instagram', href: 'https://instagram.com/amdejewellery', icon: Instagram, tone: 'bg-[#e88f8c]' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@amdejewellery', icon: Music2, tone: 'bg-[#f0b56f]' },
  { label: 'Facebook', href: 'https://facebook.com/amdejewellery', icon: Facebook, tone: 'bg-[#7aa7d9]' },
];

export default function CatalogPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [profileCards, setProfileCards] = useState<ProfileJewelleryCard[]>([]);
  const [profileCardsLoading, setProfileCardsLoading] = useState(true);
  const [profileCardsError, setProfileCardsError] = useState('');
  const [notebookSessionId, setNotebookSessionId] = useState('');
  const [savedProductIds, setSavedProductIds] = useState<Set<string>>(new Set());
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [notebookMessage, setNotebookMessage] = useState('');

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      try {
        let sessionId = localStorage.getItem('amdeNotebookSession');
        if (!sessionId || !/^[a-f0-9]{32,64}$/i.test(sessionId)) {
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          sessionId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
          localStorage.setItem('amdeNotebookSession', sessionId);
        }

        const [cardsResponse, notebookResponse] = await Promise.all([
          fetch('/api/products?profileCards=1'),
          fetch(`/api/notebook?sessionId=${encodeURIComponent(sessionId)}`),
        ]);
        if (!cardsResponse.ok || !notebookResponse.ok) {
          throw new Error('Jewellery cards or notebook could not be loaded.');
        }
        const [cardsData, notebookData] = await Promise.all([
          cardsResponse.json() as Promise<ProfileJewelleryCard[]>,
          notebookResponse.json() as Promise<{ productId: string }[]>,
        ]);
        if (!active) return;
        setNotebookSessionId(sessionId);
        setProfileCards(Array.isArray(cardsData) ? cardsData.slice(0, 5) : []);
        setSavedProductIds(new Set(Array.isArray(notebookData) ? notebookData.map((item) => item.productId) : []));
      } catch (error) {
        if (!active) return;
        console.error('Failed to load profile jewellery:', error);
        setProfileCardsError('Jewellery highlights are temporarily unavailable.');
      } finally {
        if (active) setProfileCardsLoading(false);
      }
    };

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const handleNotebookSave = async (productId: string) => {
    if (!notebookSessionId || savingProductId) return;
    setSavingProductId(productId);
    setNotebookMessage('');
    try {
      const saved = savedProductIds.has(productId);
      const response = await fetch(
        saved
          ? `/api/notebook/${encodeURIComponent(productId)}?sessionId=${encodeURIComponent(notebookSessionId)}`
          : '/api/notebook',
        saved
          ? { method: 'DELETE' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: notebookSessionId, productId }),
            }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update your notebook.');

      setSavedProductIds((current) => {
        const next = new Set(current);
        if (saved) next.delete(productId);
        else next.add(productId);
        return next;
      });
      setNotebookMessage(saved ? 'Removed from your notebook.' : 'Saved to your notebook.');
    } catch (error) {
      console.error('Failed to update notebook:', error);
      setNotebookMessage(error instanceof Error ? error.message : 'Could not update your notebook.');
    } finally {
      setSavingProductId(null);
    }
  };

  const palette = useMemo(() => {
    if (theme === 'dark') {
      return {
        page: 'bg-[#0b0b0b]',
        shell: 'bg-[#171717]',
        text: 'text-[#f5f0e6]',
        muted: 'text-[#afa99c]',
        pill: 'bg-[#f5f0e6]/10',
        border: 'border-[#c6a15b]/40',
        button: 'bg-[#d4af37] text-[#111111]',
        secondary: 'bg-[#1c1b19] text-[#f5f0e6]',
      };
    }

    return {
      page: 'bg-[#f6f2ea]',
      shell: 'bg-[#f4efe4]',
      text: 'text-[#251f18]',
      muted: 'text-[#81776a]',
      pill: 'bg-[#efe7db]',
      border: 'border-[#b99548]/40',
      button: 'bg-[#b99548] text-[#fffaf0]',
      secondary: 'bg-[#f4efe4] text-[#251f18]',
    };
  }, [theme]);

  return (
    <div className={`min-h-screen ${palette.page} px-4 py-6 transition-colors duration-300 sm:py-10`}>
      <div className={`mx-auto max-w-[430px] overflow-hidden rounded-[28px] border ${palette.border} ${palette.shell} shadow-[0_20px_50px_rgba(35,27,18,0.12)]`}>
        <header className="flex items-center justify-between px-4 pb-2 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d4af37]/70 bg-[#f9f1e1] text-lg font-serif text-[#1d1a17] shadow-inner">
              <span className="translate-y-[-2px]">A</span>
            </div>
            <div className="font-serif text-[2rem] leading-none tracking-[-0.05em] text-[#1a1714]">
              AMDE
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
              className={`flex h-10 w-10 items-center justify-center rounded-full border border-[#d9c7a7] bg-[#f5f0e7] text-[#1d1a17] shadow-sm`}
            >
              <Moon size={18} />
            </button>
            <button
              type="button"
              aria-label="Share profile"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d9c7a7] bg-[#f5f0e7] text-[#1d1a17] shadow-sm"
            >
              <Share2 size={18} />
            </button>
            <button
              type="button"
              aria-label="Menu"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d9c7a7] bg-[#f5f0e7] text-[#1d1a17] shadow-sm"
            >
              <Menu size={18} />
            </button>
          </div>
        </header>

        <main className="px-4 pb-4">
          <div className="flex items-center justify-center pb-2 pt-2">
            <div className="relative flex h-36 w-36 items-center justify-center rounded-full border-[3px] border-[#d5b77e] bg-[#f3ead8] shadow-[inset_0_0_0_3px_rgba(255,255,255,0.4)]">
              <div className="absolute inset-2 rounded-full border border-[#d4af37]/70" />
              <span className="relative font-serif text-[5rem] leading-none tracking-[-0.08em] text-[#201d19]">
                A
              </span>
            </div>
          </div>

          <div className="text-center">
            <h1 className={`font-serif text-[3.2rem] leading-none tracking-[-0.06em] ${palette.text}`}>
              AMDE JEWELLERY
            </h1>

            <div className="mt-3 flex items-center justify-center gap-2 text-[#a38148]">
              <Check className="h-4 w-4" />
            </div>

            <p className={`mt-4 text-[0.95rem] italic ${palette.muted}`}>
              @amdejewellery
            </p>

            <p className={`mt-3 font-serif text-[2.1rem] leading-none tracking-[-0.04em] ${palette.text}`}>
              Timeless Elegance.
            </p>
            <p className={`font-serif text-[2.1rem] leading-none tracking-[-0.04em] ${palette.text}`}>
              Beautifully Crafted.
            </p>

            <div className={`mt-6 flex items-center justify-center gap-3 rounded-full px-4 py-3 ${palette.pill} ${palette.text}`}>
              <MapPin className="h-4 w-4" />
              <span className="text-sm font-medium">Addis Ababa, Ethiopia</span>
            </div>
          </div>

          <div className="mt-6 border-y border-[#8e7a58]/30 py-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <div className={`font-serif text-[1.9rem] leading-none ${palette.text}`}>
                    {stat.value}
                  </div>
                  <div className={`mt-2 text-[0.72rem] uppercase tracking-[0.14em] ${palette.muted}`}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-4">
            {socialLinks.map(({ label, href, icon: Icon, tone }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className={`flex h-14 w-14 items-center justify-center rounded-full shadow-sm transition hover:scale-105 ${tone} ${label === 'Call' ? 'text-[#1d1a17]' : 'text-white'}`}
              >
                <Icon size={28} />
              </a>
            ))}
          </div>

          <div className="mt-7 space-y-3">
            <a
              href="#jewellery-highlights"
              className={`flex w-full items-center justify-center gap-3 rounded-[22px] px-5 py-4 text-lg font-semibold shadow-[0_10px_20px_rgba(0,0,0,0.08)] transition hover:translate-y-[-1px] ${palette.button}`}
            >
              <Sparkles size={18} />
              Explore jewellery
              <ChevronRight size={18} />
            </a>

            <a
              href="tel:+251911234567"
              className={`flex w-full items-center justify-center gap-3 rounded-[22px] border px-5 py-4 text-lg font-semibold transition hover:translate-y-[-1px] ${palette.secondary} ${palette.border}`}
            >
              <Phone size={18} />
              Call the atelier
            </a>
          </div>

          <section aria-labelledby="jewellery-highlights" className="mt-8">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#a38148]">
                  AMDE collection
                </p>
                <h2 id="jewellery-highlights" className={`mt-1 font-serif text-2xl ${palette.text}`}>
                  Jewellery highlights
                </h2>
              </div>
              {profileCards.length > 0 && (
                <span className={`text-xs ${palette.muted}`}>{profileCards.length} featured</span>
              )}
            </div>

            {profileCardsLoading ? (
              <div className={`rounded-2xl border ${palette.border} px-4 py-6 text-center text-sm ${palette.muted}`}>
                Loading jewellery…
              </div>
            ) : profileCardsError ? (
              <div role="status" className={`rounded-2xl border ${palette.border} px-4 py-6 text-center text-sm ${palette.muted}`}>
                {profileCardsError}
              </div>
            ) : profileCards.length === 0 ? (
              <div className={`rounded-2xl border ${palette.border} px-4 py-6 text-center text-sm ${palette.muted}`}>
                Jewellery highlights will appear here soon.
              </div>
            ) : (
              <div className="space-y-4">
                {profileCards.map((card) => {
                  const image = card.images?.[0]?.url;
                  const saved = savedProductIds.has(card.id);
                  return (
                    <article key={card.id} className={`overflow-hidden rounded-2xl border ${palette.border} ${theme === 'dark' ? 'bg-[#1c1b19]' : 'bg-white'} shadow-sm`}>
                      <div className="aspect-[1.65/1] overflow-hidden bg-[#f3eee4]">
                        {image ? (
                          <img src={image} alt={card.name} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center font-serif text-lg text-[#9a8865]">
                            AMDE JEWELLERY
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className={`font-serif text-xl ${palette.text}`}>{card.name}</h3>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#a38148]">
                              {card.material || 'Gold & Silver Jewellery'}
                            </p>
                          </div>
                          <Sparkles size={17} className="mt-1 shrink-0 text-[#b99548]" aria-hidden="true" />
                        </div>
                        {card.description && (
                          <p className={`mt-3 whitespace-pre-line text-sm leading-relaxed ${palette.muted}`}>
                            {card.description}
                          </p>
                        )}
                        <button
                          type="button"
                          disabled={!notebookSessionId || savingProductId === card.id}
                          onClick={() => void handleNotebookSave(card.id)}
                          aria-pressed={saved}
                          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
                            saved
                              ? 'border-[#b99548] bg-[#f4efe4] text-[#795d2e]'
                              : `${palette.border} ${palette.secondary}`
                          }`}
                        >
                          {saved ? <BookmarkCheck size={17} /> : <BookHeart size={17} />}
                          {savingProductId === card.id ? 'Saving…' : saved ? 'Saved to notebook' : 'Save to notebook'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {notebookMessage && (
              <p role="status" className={`mt-3 text-center text-xs ${palette.muted}`}>
                {notebookMessage}
              </p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
