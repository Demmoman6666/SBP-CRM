// app/purchase-ordering/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

type Supplier = { id: string; name: string };
type Location = { id: string; name: string; tag?: string | null };

type ItemRow = {
  sku: string;
  title: string;
  variantId?: string | null;

  inventoryQuantity?: number;   // on-hand
  costAmount?: number;          // unit cost
  priceAmount?: number | null;

  sales30?: number;
  sales60?: number;

  avgDaily?: number;
  forecastQty?: number;
  suggestedQty?: number;
  orderQty: number;
};

type SortKey = 'sku' | 'title' | 'sales30' | 'sales60' | 'suggestedQty';
type SortDir = 'asc' | 'desc';

export default function PurchaseOrderingPage() {
  // dropdown data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // selections / controls
  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [daysOfStock, setDaysOfStock] = useState<number>(14);
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [includePaidFallback, setIncludePaidFallback] = useState<boolean>(true);

  // ui state
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  // sorting
  const [sortBy, setSortBy] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(k); setSortDir('asc'); }
  };
  const Caret = ({ k }: { k: SortKey }) =>
    sortBy === k ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  // helpers
  const fmt = (n: number | null | undefined) => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v.toFixed(2) : '0.00';
  };

  function nearestBucketRate(row: ItemRow, lbDays: number): number {
    const d30 = typeof row.sales30 === 'number' ? row.sales30! : undefined;
    const d60 = typeof row.sales60 === 'number' ? row.sales60! : undefined;
    if (d30 == null && d60 == null) return 0;
    const use60 = lbDays >= 45;
    if (use60 && d60 != null) return d60 / 60;
    if (!use60 && d30 != null) return d30 / 30;
    if (d60 != null) return d60 / 60;
    if (d30 != null) return d30 / 30;
    return 0;
  }

  function recalcDerived(rows: ItemRow[], lbDays: number, horizon: number): ItemRow[] {
    return rows.map(r => {
      const avg = nearestBucketRate(r, lbDays);
      const forecast = avg * Math.max(0, horizon || 0);
      const onHand = Number(r.inventoryQuantity ?? 0);
      const suggested = Math.max(0, Math.ceil(forecast - onHand));
      return { ...r, avgDaily: avg, forecastQty: forecast, suggestedQty: suggested };
    });
  }

  // load dropdowns
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const [sRes, lRes] = await Promise.all([
          fetch('/api/shopify/suppliers', { cache: 'no-store' }),
          fetch('/api/shopify/locations', { cache: 'no-store' }),
        ]);
        const sJson = await sRes.json().catch(() => ({ ok: false }));
        const lJson = await lRes.json().catch(() => ({ ok: false }));

        if (sJson?.ok) setSuppliers(sJson.suppliers ?? []);
        else setError(sJson?.error || 'Failed to load suppliers');

        if (lJson?.ok) setLocations(lJson.locations ?? []);
        else setError(prev => prev ?? (lJson?.error || 'Failed to load locations'));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  // fetch items + sales for a supplier
  async function fetchPlan(forSupplierId: string) {
    if (!forSupplierId) { setError('Please choose a supplier'); return; }
    setLoading(true);
    setError(null);
    setStatus('Loading items…');
    setItems([]);

    try {
      // Items (cost, stock)
      const itsRes = await fetch(
        `/api/shopify/items-by-supplier?supplierId=${encodeURIComponent(forSupplierId)}&limit=800` +
        (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''),
        { cache: 'no-store' }
      );
      const itsJson = await itsRes.json().catch(() => ({ ok: false }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const baseRows: ItemRow[] = (itsJson.items as any[]).map((it: any) => {
        const cleanTitle = String(it.title || '').replace(/\s+—\s+Default Title$/i, '');
        return {
          sku: it.sku,
          title: cleanTitle,
          variantId: it.variantId || null,
          inventoryQuantity: Number(it.inventoryQuantity ?? 0),
          costAmount: typeof it.costAmount === 'number' ? it.costAmount : Number(it.costAmount ?? 0),
          priceAmount: it.priceAmount == null ? null : Number(it.priceAmount),
          orderQty: 0,
        };
      });
      if (!baseRows.length) { setItems([]); setStatus('No items found for this supplier.'); return; }

      setItems(baseRows);
      setStatus(`Loaded ${baseRows.length} item(s). Getting sales…`);

      // Sales (30/60)
      const skus = baseRows.map(r => r.sku).filter(Boolean).slice(0, 800);
      if (skus.length) {
        const salesRes = await fetch('/api/shopify/sales-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skus,
            locationId: locationId || undefined,
            days30: true,
            days60: true,
            countPaidIfNoFulfillments: includePaidFallback,
          }),
        });
        const salesJson = await salesRes.json().catch(() => ({ ok: false }));
        if (!salesJson?.ok) throw new Error(salesJson?.error || 'Failed to fetch sales');

        const bySku: Record<string, { d30?: number; d60?: number }> = salesJson.sales || {};
        const merged = baseRows.map(r => ({
          ...r,
          sales30: bySku[r.sku]?.d30 ?? 0,
          sales60: bySku[r.sku]?.d60 ?? 0,
        }));

        setItems(recalcDerived(merged, lookbackDays, daysOfStock));
        setStatus(`Sales source: ${salesJson.source || 'Shopify'}`);
      } else {
        setItems(recalcDerived(baseRows, lookbackDays, daysOfStock));
        setStatus('No SKUs found to compute sales.');
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  // auto refresh on selections
  useEffect(() => { if (supplierId) fetchPlan(supplierId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplierId, locationId, includePaidFallback]);

  // recompute suggested on horizon/lookback change
  useEffect(() => { setItems(prev => recalcDerived(prev, lookbackDays, daysOfStock)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [daysOfStock, lookbackDays]);

  // sorting
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

  const hasRows = items.length > 0;
  const grandTotal = useMemo(() => items.reduce((acc, r) => acc + (Number(r.costAmount ?? 0) * Number(r.orderQty ?? 0)), 0), [items]);

  function applySuggestedAll() {
    setItems(prev => prev.map(r => ({ ...r, orderQty: Math.max(0, Math.ceil(r.suggestedQty ?? 0)) })));
  }

  return (
    <div className="p-6 space-y-6">
      {/* Top controls in a neutral card */}
      <div className="rounded-xl border border-gray-200 bg-white/60 backdrop-blur-sm shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 p-4">
          <label className="flex flex-col text-sm">
            <span className="text-gray-700">Days of stock</span>
            <input
              type="number" min={1}
              className="mt-1 border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
              value={daysOfStock}
              onChange={(e) => setDaysOfStock(Math.max(1, Number(e.target.value || 0)))}
            />
          </label>

          <label className="flex flex-col text-sm">
            <span className="text-gray-700">Look-back (days)</span>
            <input
              type="number" min={7}
              className="mt-1 border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Math.max(7, Number(e.target.value || 0)))}
            />
            <span className="text-[11px] text-gray-500 mt-1">Uses the closest of 30/60d sales to estimate avg/day.</span>
          </label>

          <label className="flex flex-col text-sm">
            <span className="text-gray-700">Location</span>
            <select
              className="mt-1 border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">All</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            <span className="text-gray-700">Supplier</span>
            <select
              className="mt-1 border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Choose…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <label className="flex flex-col justify-center text-sm">
            <span className="inline-flex items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                className="accent-gray-800"
                checked={includePaidFallback}
                onChange={(e) => setIncludePaidFallback(e.target.checked)}
              />
              Count paid orders if no fulfillments
            </span>
            <span className="text-[11px] text-gray-500">Applies when “All” locations selected.</span>
          </label>
        </div>

        <div className="flex items-center gap-3 border-t border-gray-200 p-3">
          <button
            className="px-3 py-2 rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-50"
            disabled={!supplierId || loading}
            onClick={() => fetchPlan(supplierId)}
          >
            {loading ? "Loading…" : "Generate plan"}
          </button>

          <button
            className="px-3 py-2 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            disabled={!hasRows}
            onClick={applySuggestedAll}
          >
            Auto-fill with Suggested
          </button>

          {!!status && <span className="text-xs text-gray-600">Sales source: {status.replace(/^Sales source:\s*/i,'')}</span>}
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* DATA TABLE */}
      <div className="rounded-xl ring-1 ring-gray-200 shadow-sm overflow-hidden bg-white">
        <div className="overflow-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[140px]" />
              <col />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[100px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
            </colgroup>
            <thead className="bg-gray-50/80 backdrop-blur sticky top-0 z-10">
              <tr className="text-gray-700">
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
                <th className="text-right p-3">In stock</th>
                <th className="text-right p-3">Cost</th>
                <th className="text-right p-3">
                  <button className="font-medium hover:underline" onClick={() => toggleSort('sales30')}>
                    30d sales <Caret k="sales30" />
                  </button>
                </th>
                <th className="text-right p-3">
                  <button className="font-medium hover:underline" onClick={() => toggleSort('sales60')}>
                    60d sales <Caret k="sales60" />
                  </button>
                </th>
                <th className="text-right p-3">Avg/day</th>
                <th className="text-right p-3">Forecast</th>
                <th className="text-right p-3">
                  <button className="font-medium hover:underline" onClick={() => toggleSort('suggestedQty')}>
                    Suggested <Caret k="suggestedQty" />
                  </button>
                </th>
                <th className="text-right p-3">Order qty</th>
                <th className="text-right p-3">Line total</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!hasRows && (
                <tr><td className="p-4 text-gray-500" colSpan={11}>Pick a supplier and click “Generate plan”…</td></tr>
              )}

              {sorted.map((r, idx) => {
                const costNum = Number(r.costAmount ?? 0);
                const lineTotal = costNum * Number(r.orderQty ?? 0);
                return (
                  <tr key={r.sku} className={idx % 2 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-3 text-gray-900">{r.sku}</td>
                    <td className="p-3 text-gray-900">{r.title}</td>
                    <td className="p-3 text-right tabular-nums">{r.inventoryQuantity ?? 0}</td>
                    <td className="p-3 text-right tabular-nums">{costNum ? fmt(costNum) : '—'}</td>
                    <td className="p-3 text-right tabular-nums">{r.sales30 ?? 0}</td>
                    <td className="p-3 text-right tabular-nums">{r.sales60 ?? 0}</td>
                    <td className="p-3 text-right tabular-nums">{(r.avgDaily ?? 0).toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums">{Math.ceil(r.forecastQty ?? 0)}</td>
                    <td className="p-3 text-right tabular-nums">{r.suggestedQty ?? 0}</td>
                    <td className="p-3 text-right">
                      <input
                        type="number"
                        className="border border-gray-300 rounded-md p-2 w-24 text-right focus:outline-none focus:ring-2 focus:ring-gray-400"
                        value={r.orderQty}
                        min={0}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value || 0));
                          setItems(prev => prev.map(x => x.sku === r.sku ? { ...x, orderQty: v } : x));
                        }}
                      />
                    </td>
                    <td className="p-3 text-right tabular-nums">{lineTotal ? fmt(lineTotal) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasRows && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm">
            <div className="text-gray-600">
              Sales are from Shopify <em>Fulfillments</em>. If enabled, paid orders are counted when there are no
              fulfillments (only when “All” locations is selected).
            </div>
            <div className="font-semibold text-gray-900">
              Grand total: {fmt(grandTotal)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
