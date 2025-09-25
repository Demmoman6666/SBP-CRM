// app/purchase-ordering/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

type Supplier = { id: string; name: string };
type Location = { id: string; name: string; tag?: string | null };

type ItemRow = {
  sku: string;
  title: string;
  variantId?: string | null;

  // From /api/shopify/items-by-supplier
  inventoryQuantity?: number;   // on-hand (total or per selected location)
  costAmount?: number;          // unit cost (number)
  priceAmount?: number;         // optional selling price (not shown but available)

  // From /api/shopify/sales-by-sku
  sales30?: number;
  sales60?: number;

  // Derived
  avgDaily?: number;            // calculated from sales + lookback
  forecastQty?: number;         // avgDaily * daysOfStock
  suggestedQty?: number;        // ceil(max(0, forecastQty - inventoryQuantity))
  orderQty: number;             // user-editable
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
  const [includePaidFallback, setIncludePaidFallback] = useState<boolean>(true); // default include paid & unpaid

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
  const Caret = ({ k }: { k: SortKey }) => sortBy === k ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  // Helpers
  function nearestBucketRate(row: ItemRow, lbDays: number): number {
    const d30 = typeof row.sales30 === 'number' ? row.sales30! : undefined;
    const d60 = typeof row.sales60 === 'number' ? row.sales60! : undefined;
    if (d30 == null && d60 == null) return 0;

    // Choose the bucket (30/60) that’s closest to the requested lookback
    const use60 = lbDays >= 45; // simple threshold
    if (use60 && d60 != null) return d60 / 60;
    if (!use60 && d30 != null) return d30 / 30;

    // Fallbacks if only one bucket is present
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

  // Load dropdowns
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

  // Fetch plan (items + sales) for a supplier
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
      // 1) Items by supplier (includes cost & stock)
      const itsRes = await fetch(
        `/api/shopify/items-by-supplier?supplierId=${encodeURIComponent(forSupplierId)}&limit=800` +
        (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''),
        { cache: 'no-store' }
      );
      const itsJson = await itsRes.json().catch(() => ({ ok: false }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const baseRows: ItemRow[] = (itsJson.items as any[]).map((it: any) => ({
        sku: it.sku,
        title: it.title || '',
        variantId: it.variantId || null,
        inventoryQuantity: Number(it.inventoryQuantity ?? 0),
        costAmount: typeof it.costAmount === 'number' ? it.costAmount : Number(it.costAmount ?? 0),
        priceAmount: typeof it.priceAmount === 'number' ? it.priceAmount : Number(it.priceAmount ?? 0),
        orderQty: 0,
      }));
      if (!baseRows.length) {
        setItems([]);
        setStatus('No items found for this supplier.');
        return;
      }

      setItems(baseRows);
      setStatus(`Loaded ${baseRows.length} item(s). Getting sales…`);

      // 2) Sales 30/60 by SKU
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
            // default is to count both paid and unpaid if there are no fulfillments
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

        // 3) Derive avg/day, forecast, suggested
        const withDerived = recalcDerived(merged, lookbackDays, daysOfStock);
        setItems(withDerived);
        setStatus(`Sales source: ${salesJson.source || 'Shopify'}`);
      } else {
        // No SKUs to look up — just compute derived with zeros
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

  // Auto-refresh when supplier / location / includePaidFallback changes
  useEffect(() => {
    if (supplierId) fetchPlan(supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, locationId, includePaidFallback]);

  // Recalculate derived fields when daysOfStock or lookbackDays change
  useEffect(() => {
    setItems(prev => recalcDerived(prev, lookbackDays, daysOfStock));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysOfStock, lookbackDays]);

  // Sorting
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

  // Bulk helper: apply suggested to all orderQty
  function applySuggestedAll() {
    setItems(prev => prev.map(r => ({ ...r, orderQty: Math.max(0, Math.ceil(r.suggestedQty ?? 0)) })));
  }

  const grandTotal = useMemo(() => {
    return items.reduce((acc, r) => acc + (Number(r.costAmount ?? 0) * Number(r.orderQty ?? 0)), 0);
  }, [items]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Ordering</h1>
        <span className="text-sm text-gray-500">Forecast demand &amp; create POs (Shopify)</span>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="flex flex-col text-sm">
          Days of stock
          <input
            type="number"
            min={1}
            className="border rounded p-2"
            value={daysOfStock}
            onChange={(e) => setDaysOfStock(Math.max(1, Number(e.target.value || 0)))}
          />
        </label>

        <label className="flex flex-col text-sm">
          Look-back (days)
          <input
            type="number"
            min={7}
            className="border rounded p-2"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Math.max(7, Number(e.target.value || 0)))}
          />
          <span className="text-[11px] text-gray-500 mt-1">
            Uses the closest of 30/60d sales to estimate avg/day.
          </span>
        </label>

        <label className="flex flex-col text-sm">
          Location
          <select
            className="border rounded p-2"
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
          Supplier
          <select
            className="border rounded p-2"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose…</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col justify-end text-sm">
          <span className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-black"
              checked={includePaidFallback}
              onChange={(e) => setIncludePaidFallback(e.target.checked)}
            />
            Count paid orders if no fulfillments
          </span>
          <span className="text-[11px] text-gray-500">Applies when “All” locations selected.</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={!supplierId || loading}
          onClick={() => fetchPlan(supplierId)}
        >
          {loading ? "Loading…" : "Generate plan"}
        </button>

        <button
          className="px-3 py-2 rounded border border-gray-300 disabled:opacity-50"
          disabled={!hasRows}
          onClick={applySuggestedAll}
          title="Fill order quantities with Suggested"
        >
          Auto-fill with Suggested
        </button>

        {!!status && <span className="text-xs text-gray-600">{status}</span>}
      </div>

      {error && (
        <div className="p-3 text-sm rounded bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Items table */}
      <div className="border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="whitespace-nowrap">
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
          <tbody>
            {!hasRows && (
              <tr><td className="p-3" colSpan={11}>Pick a supplier and click “Generate plan”…</td></tr>
            )}
            {sorted.map((r) => {
              const cost = Number(r.costAmount ?? 0);
              const lineTotal = cost * Number(r.orderQty ?? 0);
              return (
                <tr key={r.sku} className="border-t">
                  <td className="p-3">{r.sku}</td>
                  <td className="p-3">{r.title}</td>
                  <td className="p-3 text-right">{r.inventoryQuantity ?? 0}</td>
                  <td className="p-3 text-right">
                    {cost ? cost.toFixed(2) : '—'}
                  </td>
                  <td className="p-3 text-right">{r.sales30 ?? 0}</td>
                  <td className="p-3 text-right">{r.sales60 ?? 0}</td>
                  <td className="p-3 text-right">{(r.avgDaily ?? 0).toFixed(2)}</td>
                  <td className="p-3 text-right">{Math.ceil(r.forecastQty ?? 0)}</td>
                  <td className="p-3 text-right">{r.suggestedQty ?? 0}</td>
                  <td className="p-3 text-right">
                    <input
                      type="number"
                      className="border rounded p-2 w-24 text-right"
                      value={r.orderQty}
                      min={0}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value || 0));
                        setItems(prev => prev.map(x => x.sku === r.sku ? { ...x, orderQty: v } : x));
                      }}
                    />
                  </td>
                  <td className="p-3 text-right">{lineTotal ? lineTotal.toFixed(2) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-700">
        <div>
          Sales are counted from Shopify <em>Fulfillments</em> (net shipped units). If enabled, paid orders are counted
          when there are no fulfillments (only when “All” locations is selected).
        </div>
        <div className="font-medium">
          Grand total: {grandTotal ? grandTotal.toFixed(2) : '0.00'}
        </div>
      </div>
    </div>
  );
}
