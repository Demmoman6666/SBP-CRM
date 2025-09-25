// app/purchase-ordering/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

type Supplier = { id: string; name: string };
type Location = { id: string; name: string; tag?: string | null };
type ItemRow = {
  sku: string;
  title: string;
  orderQty: number;
  sales30?: number;
  sales60?: number;
};

type ProductType = { name: string };                 // from /api/shopify/product-types
type ProductCategory = { id: string; name: string }; // from /api/shopify/product-categories
type Collection = { id: string; title: string };     // from /api/shopify/collections

type SortKey = 'sku' | 'title' | 'sales30' | 'sales60';
type SortDir = 'asc' | 'desc';

export default function PurchaseOrderingPage() {
  /** Dropdown data */
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  /** Selections / controls */
  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>(''); // blank = All
  const [daysOfStock, setDaysOfStock] = useState<number>(14);
  const [lookbackDays, setLookbackDays] = useState<number>(60);

  // Filters (optional)
  const [productType, setProductType] = useState<string>('');         // string name
  const [productCategoryId, setProductCategoryId] = useState<string>(''); // taxonomy id
  const [collectionId, setCollectionId] = useState<string>('');       // collection gid/num id

  // Default: include BOTH paid and unpaid (paid-count fallback ON)
  const [includePaidFallback, setIncludePaidFallback] = useState<boolean>(true);

  /** UI state */
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  /** Sorting */
  const [sortBy, setSortBy] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(k); setSortDir('asc'); }
  };

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const av = (a as any)[sortBy] ?? '';
      const bv = (b as any)[sortBy] ?? '';
      if (typeof av === 'number' || typeof bv === 'number') return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return arr;
  }, [items, sortBy, sortDir]);

  /** Load dropdowns (Shopify vendors, locations, and filter options) */
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const [sRes, lRes, tRes, cRes, colRes] = await Promise.all([
          fetch('/api/shopify/suppliers', { cache: 'no-store' }),
          fetch('/api/shopify/locations', { cache: 'no-store' }),
          fetch('/api/shopify/product-types', { cache: 'no-store' }),
          fetch('/api/shopify/product-categories', { cache: 'no-store' }),
          fetch('/api/shopify/collections', { cache: 'no-store' }),
        ]);

        const [sJson, lJson, tJson, catJson, colJson] = await Promise.all([
          sRes.json().catch(() => ({ ok: false })),
          lRes.json().catch(() => ({ ok: false })),
          tRes.json().catch(() => ({ ok: false })),
          cRes.json().catch(() => ({ ok: false })),
          colRes.json().catch(() => ({ ok: false })),
        ]);

        if (sJson?.ok) setSuppliers(sJson.suppliers ?? []); else setError(sJson?.error || 'Failed to load suppliers');
        if (lJson?.ok) setLocations(lJson.locations ?? []); else setError(prev => prev ?? (lJson?.error || 'Failed to load locations'));
        if (tJson?.ok) setProductTypes(tJson.types ?? []);    // optional
        if (catJson?.ok) setProductCategories(catJson.categories ?? []); // optional
        if (colJson?.ok) setCollections(colJson.collections ?? []);      // optional
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  /** Fetch items + sales */
  async function fetchPlan(forSupplierId: string) {
    if (!forSupplierId) {
      setError('Please choose a supplier');
      return;
    }
    setLoading(true);
    setError(null);
    setStatus('Loading items…');
    setItems([]);

    try {
      // Build querystring with optional filters
      const qs = new URLSearchParams();
      qs.set('supplierId', forSupplierId);
      qs.set('limit', '800');
      if (productType) qs.set('productType', productType);
      if (productCategoryId) qs.set('productCategoryId', productCategoryId);
      if (collectionId) qs.set('collectionId', collectionId);

      // 1) Items (variants with SKUs) by vendor from Shopify GraphQL
      const itsRes = await fetch(`/api/shopify/items-by-supplier?${qs.toString()}`, { cache: 'no-store' });
      const itsJson = await itsRes.json().catch(() => ({ ok: false }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const baseRows: ItemRow[] = (itsJson.items as any[]).map((it: any) => ({
        sku: it.sku,
        title: it.title || '',
        orderQty: 0,
      }));
      if (!baseRows.length) {
        setItems([]);
        setStatus('No items found for this selection.');
        return;
      }

      setItems(baseRows);
      setStatus(`Loaded ${baseRows.length} item(s). Getting sales…`);

      // 2) Sales 30/60 by SKU from Shopify fulfillments
      const skus = baseRows.map(r => r.sku).filter(Boolean).slice(0, 800);
      if (skus.length) {
        const salesRes = await fetch('/api/shopify/sales-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skus,
            locationId: locationId || undefined, // blank = All
            days30: true,
            days60: true,
            countPaidIfNoFulfillments: includePaidFallback,
            lookbackDays, // if your API wants this; safe to include
          }),
        });
        const salesJson = await salesRes.json().catch(() => ({ ok: false }));
        if (!salesJson?.ok) throw new Error(salesJson?.error || 'Failed to fetch sales');

        const bySku: Record<string, { d30?: number; d60?: number }> = salesJson.sales || {};
        setItems(prev =>
          prev.map(r => ({
            ...r,
            sales30: bySku[r.sku]?.d30 ?? 0,
            sales60: bySku[r.sku]?.d60 ?? 0,
          })),
        );
        setStatus(`Sales source: ${salesJson.source || 'Shopify'}`);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  /** Auto-refresh when relevant inputs change */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (supplierId) fetchPlan(supplierId); }, [
    supplierId,
    locationId,
    productType,
    productCategoryId,
    collectionId,
    includePaidFallback,
    lookbackDays,
  ]);

  const hasRows = items.length > 0;
  const Caret = ({ k }: { k: SortKey }) => (sortBy === k ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null);

  return (
    <div className="p-6 space-y-6">
      {/* Header + actions */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Ordering</h1>
          <p className="text-sm text-gray-500">Forecast demand &amp; create POs (Shopify)</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="px-4 py-2 rounded-2xl bg-black text-white disabled:opacity-50"
            disabled={!supplierId || loading}
            onClick={() => fetchPlan(supplierId)}
          >
            {loading ? 'Loading…' : 'Generate plan'}
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="accent-black"
              checked={includePaidFallback}
              onChange={(e) => setIncludePaidFallback(e.target.checked)}
            />
            Include paid orders when no fulfillments
          </label>
        </div>
      </div>

      {/* Planning block */}
      <section className="rounded-2xl border p-4 md:p-5 bg-white">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Planning</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col text-sm">
            Supplier <span className="text-xs text-gray-500">(required)</span>
            <select
              className="mt-1 border rounded p-2"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Choose…</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Location
            <select
              className="mt-1 border rounded p-2"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">All</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Days of stock
            <input
              type="number"
              className="mt-1 border rounded p-2"
              value={daysOfStock}
              min={0}
              onChange={(e) => setDaysOfStock(Number(e.target.value || 0))}
            />
          </label>

          <label className="flex flex-col text-sm">
            Lookback (days)
            <input
              type="number"
              className="mt-1 border rounded p-2"
              value={lookbackDays}
              min={0}
              onChange={(e) => setLookbackDays(Number(e.target.value || 0))}
            />
          </label>
        </div>
      </section>

      {/* Filters block */}
      <section className="rounded-2xl border p-4 md:p-5 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-700">Filters</h2>
          {(productType || productCategoryId || collectionId) && (
            <button
              className="text-xs text-gray-600 hover:underline"
              onClick={() => { setProductType(''); setProductCategoryId(''); setCollectionId(''); }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col text-sm">
            Product type
            <select
              className="mt-1 border rounded p-2"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
            >
              <option value="">All</option>
              {productTypes.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Product category
            <select
              className="mt-1 border rounded p-2"
              value={productCategoryId}
              onChange={(e) => setProductCategoryId(e.target.value)}
            >
              <option value="">All</option>
              {productCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Collection
            <select
              className="mt-1 border rounded p-2"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              <option value="">All</option>
              {collections.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {!!status && <div className="text-xs text-gray-600">{status}</div>}
      {error && (
        <div className="p-3 text-sm rounded bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Items table */}
      <div className="border rounded-2xl overflow-auto bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">
                <button className="font-medium hover:underline" onClick={() => toggleSort('sku')}>
                  SKU <Caret k="sku" />
                </button>
              </th>
              <th className="text-left p-3">
                <button className="font-medium hover:underline" onClick={() => toggleSort('title')}>
                  Product <Caret k="title" />
                </button>
              </th>
              <th className="text-left p-3">Order qty</th>
              <th className="text-right p-3">
                <button className="font-medium hover:underline" onClick={() => toggleSort('sales30')}>
                  30 days sales <Caret k="sales30" />
                </button>
              </th>
              <th className="text-right p-3">
                <button className="font-medium hover:underline" onClick={() => toggleSort('sales60')}>
                  60 days sales <Caret k="sales60" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {!hasRows && (
              <tr><td className="p-3" colSpan={5}>Pick a supplier and click “Generate plan”…</td></tr>
            )}
            {sorted.map((r) => (
              <tr key={r.sku} className="border-t">
                <td className="p-3">{r.sku}</td>
                <td className="p-3">{r.title}</td>
                <td className="p-3">
                  <input
                    type="number"
                    className="border rounded p-2 w-28"
                    value={r.orderQty}
                    min={0}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setItems(prev => prev.map(x => x.sku === r.sku ? { ...x, orderQty: v } : x));
                    }}
                  />
                </td>
                <td className="p-3 text-right">{r.sales30 ?? 0}</td>
                <td className="p-3 text-right">{r.sales60 ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Sales are counted from Shopify <em>Fulfillments</em> (net shipped units). With the checkbox enabled (default),
        paid order quantities are counted when there are no fulfillments (and when Location is “All”).
      </p>
    </div>
  );
}
