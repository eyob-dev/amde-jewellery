import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Pencil, Plus, Save, Star, X } from 'lucide-react';

interface JewelleryCategory {
  id: string;
  name: string;
}

interface JewelleryImage {
  url: string;
}

interface JewelleryProduct {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  material: string | null;
  price: string | null;
  visible: number;
  profile_card: number;
  available: number;
  order_index: number;
  images: JewelleryImage[];
}

interface ProductDraft {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  material: string;
  price: string;
  image: string;
  profileCard: boolean;
  visible: boolean;
  available: boolean;
}

const blankDraft = (categoryId = ''): ProductDraft => ({
  categoryId,
  name: '',
  description: '',
  material: '',
  price: '',
  image: '',
  profileCard: true,
  visible: true,
  available: true,
});

export default function JewelleryProfileCards({ token }: { token?: string } = {}) {
  const [products, setProducts] = useState<JewelleryProduct[]>([]);
  const [categories, setCategories] = useState<JewelleryCategory[]>([]);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const authHeaders = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [productsResponse, categoriesResponse] = await Promise.all([
        fetch('/api/admin/products', { headers: authHeaders }),
        fetch('/api/admin/categories', { headers: authHeaders }),
      ]);
      if (productsResponse.status === 401 || categoriesResponse.status === 401) {
        throw new Error('Your admin session expired. Please sign in again.');
      }
      if (!productsResponse.ok || !categoriesResponse.ok) {
        throw new Error('Could not load jewellery cards from the server.');
      }
      const [productRows, categoryRows] = await Promise.all([
        productsResponse.json() as Promise<JewelleryProduct[]>,
        categoriesResponse.json() as Promise<JewelleryCategory[]>,
      ]);
      setProducts(Array.isArray(productRows) ? productRows : []);
      setCategories(Array.isArray(categoryRows) ? categoryRows : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load jewellery cards.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const editProduct = (product: JewelleryProduct) => {
    setNotice('');
    setDraft({
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      description: product.description ?? '',
      material: product.material ?? '',
      price: product.price ?? '',
      image: product.images?.[0]?.url ?? '',
      profileCard: Boolean(product.profile_card),
      visible: Boolean(product.visible),
      available: Boolean(product.available),
    });
  };

  const updateProduct = async (product: JewelleryProduct, profileCard: boolean) => {
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileCard }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update the profile card.');
      await load();
      setNotice(profileCard ? 'Added to the business profile.' : 'Removed from the business profile.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update the profile card.');
    }
  };

  const saveDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const editing = Boolean(draft.id);
      const response = await fetch(
        editing ? `/api/admin/products/${encodeURIComponent(draft.id!)}` : '/api/admin/products',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId: draft.categoryId,
            name: draft.name.trim(),
            description: draft.description.trim(),
            material: draft.material.trim(),
            price: draft.price.trim(),
            images: draft.image.trim() ? [draft.image.trim()] : [],
            profileCard: draft.profileCard,
            visible: draft.visible,
            available: draft.available,
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save this jewellery card.');
      setDraft(null);
      await load();
      setNotice('Jewellery card saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this jewellery card.');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > 7 * 1024 * 1024) {
      setError('The image must be smaller than 7 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) =>
        current ? { ...current, image: String(reader.result) } : current
      );
      setError('');
    };
    reader.onerror = () => setError('Could not read the selected image.');
    reader.readAsDataURL(file);
  };

  const cardCount = products.filter((product) => product.profile_card).length;

  return (
    <section className="mb-8 rounded-2xl border border-[#d6c6a5] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#a17d3c]">
            <Star size={19} />
            <h2 className="text-xl font-semibold text-[#30281d]">Jewellery on your profile</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Choose up to five pieces to show below the call button. Each card displays its image,
            carat or material, and introduction.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#f5efe3] px-3 py-1 text-sm font-semibold text-[#795d2e]">
            {cardCount} / 5 selected
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(blankDraft(categories[0]?.id ?? ''));
              setError('');
              setNotice('');
            }}
            className="flex items-center gap-2 rounded-full bg-[#8d692b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#725321]"
          >
            <Plus size={16} /> Add jewellery
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {draft && (
        <form onSubmit={saveDraft} className="mt-5 grid gap-4 rounded-xl border border-gray-200 bg-[#fcfaf6] p-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">
            Jewellery name
            <input
              required
              maxLength={150}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Category
            <select
              required
              value={draft.categoryId}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
            >
              <option value="" disabled>Select a category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Carat / material type
            <input
              maxLength={120}
              value={draft.material}
              onChange={(event) => setDraft({ ...draft, material: event.target.value })}
              placeholder="e.g. 18K gold, sterling silver"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Price (ETB)
            <input
              maxLength={60}
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Jewellery image URL
            <input
              value={draft.image.startsWith('data:image/') ? '' : draft.image}
              onChange={(event) => setDraft({ ...draft, image: event.target.value })}
              placeholder="Paste an image URL or upload an image"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#b99548] bg-white px-3 py-2 text-sm font-semibold text-[#795d2e]">
            <ImagePlus size={17} /> Upload image (max 7 MB)
            <input type="file" accept="image/*" className="hidden" onChange={(event) => uploadImage(event.target.files?.[0])} />
          </label>
          {draft.image && (
            <div className="flex items-center gap-3">
              <img src={draft.image} alt="Jewellery preview" className="h-16 w-16 rounded-lg bg-[#f4efe4] object-cover" />
              <button type="button" onClick={() => setDraft({ ...draft, image: '' })} className="text-sm text-red-600 hover:underline">
                Remove image
              </button>
            </div>
          )}
          <label className="text-sm font-medium text-gray-700 md:col-span-2">
            Introduction
            <textarea
              maxLength={1000}
              rows={3}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="A short introduction to this piece"
              className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 md:col-span-2">
            <input
              type="checkbox"
              checked={draft.profileCard}
              onChange={(event) => setDraft({ ...draft, profileCard: event.target.checked })}
            />
            Show this jewellery on the public profile
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={draft.available} onChange={(event) => setDraft({ ...draft, available: event.target.checked })} />
            Available for orders
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={draft.visible} onChange={(event) => setDraft({ ...draft, visible: event.target.checked })} />
            Visible in collection
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#8d692b] px-4 py-2 font-semibold text-white disabled:opacity-60">
              <Save size={16} /> {saving ? 'Saving…' : 'Save card'}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-gray-700">
              <X size={16} /> Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-sm text-gray-500">Loading jewellery…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-gray-500">No jewellery has been added yet.</p>
        ) : products.map((product) => {
          const selected = Boolean(product.profile_card);
          const atLimit = cardCount >= 5 && !selected;
          return (
            <article key={product.id} className="flex gap-3 rounded-xl border border-gray-200 p-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#f4efe4]">
                {product.images?.[0]?.url ? (
                  <img src={product.images[0].url} alt={product.name} className="h-full w-full object-cover" />
                ) : <div className="flex h-full items-center justify-center text-xs text-gray-400">No image</div>}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold text-gray-900">{product.name}</h3>
                <p className="truncate text-sm text-gray-500">{product.material || 'Carat / material not set'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={atLimit}
                    onClick={() => void updateProduct(product, !selected)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {selected ? 'On profile — remove' : atLimit ? 'Five-card limit' : 'Add to profile'}
                  </button>
                  <button type="button" onClick={() => editProduct(product)} aria-label={`Edit ${product.name}`} className="rounded-full bg-gray-100 p-1.5 text-gray-700 hover:bg-gray-200">
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
