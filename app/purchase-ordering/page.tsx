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

  sales30?: number;             // shipped/paid units in last 30 days
  sales60?: number;             // shipped/paid units in last 60 days
  salesCustom?: number;         // shipped/paid units in last N days
  oosDays?: number;             // days out of stock in last N days (optional)

  avgDaily?: number;            // consumption (units/day)
  forecastQty?: number;         // avgDaily * daysOfStock
  suggestedQty?: number;        // max(0, ceil(forecast - onHand))

  orderQty: number;
};

type SortKey =
  | 'sku'
  | 'title'
  | 'sales30'
  | 'sales60'
  | 'salesCustom'
  | 'oosDays'
  | 'suggestedQty';
type SortDir = 'asc' | 'desc';

// Coerce anything to a number (prevents React errors when APIs return objects)
function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'object') {
    if ('amount' in v) return toNum((v as any).amount);
    if ('available' in v) return toNum((v as any).available);
  }
  return 0;
}

export default function PurchaseOrderingPage() {
  // dropdown data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // selections / controls
  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [daysOfStock, setDaysOfStock] = useState<number>(14); // “Days of stock”
  const [lookbackDays, setLookbackDays] = useState<number>(60); // fully custom
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
    if (sortBy === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(k); setSortDir('asc'); }
  };
  const Caret = ({ k }: { k: SortKey }) =>
    sortBy === k ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  const fmt2 = (n: number | null | undefined) => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v.toFixed(2) : '0.00';
  };

  // ---- Consumption (avg/day) & suggestions
  function pickSalesForAvg(row: ItemRow, lbDays: number): number {
    if (typeof row.salesCustom === 'number' && lbDays !== 30 && lbDays !== 60) {
      return row.salesCustom!;
    }
    // choose the nearest bucket
    if (lbDays >= 45) {
      if (typeof row.sales60 === 'number') return row.sales60!;
      if (typeof row.sales30 === 'number') return row.sales30! * 2; // normalize 30d to ~60d
      return 0;
    } else {
      if (typeof row.sales30 === 'number') return row.sales30!;
      if (typeof row.sales60 === 'number') return row.sales60! / 2; // normalize 60d to ~30d
      return 0;
    }
  }

  function recalcDerived(rows: ItemRow[], lbDays: number, horizon: number): ItemRow[] {
    return rows.map((r) => {
      const totalSales = pickSalesForAvg(r, lbDays);
      const oos = Math.max(0, toNum(r.oosDays));
      // Effective days = lookback minus out-of-stock days, minimum 1 to avoid divide-by-zero
      const effectiveDays = Math.max(1, lbDays - oos);
      const avg = totalSales / effectiveDays;

      const forecast = avg * Math.max(0, horizon || 0);
      const onHand = toNum(r.inventoryQuantity);
      const suggested = Math.max(0, Math.ceil(forecast - onHand));
      return { ...r, avgDaily: avg, forecastQty: forecast, suggestedQty: suggested };
    });
  }

  // load dropdowns (Shopify vendors & locations)
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
        else setError((prev) => (prev ?? (lJson?.error || 'Failed to load locations')));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  async function fetchPlan(forSupplierId: string) {
    if (!forSupplierId) { setError('Please choose a supplier'); return; }
    setLoading(true);
    setError(null);
    setStatus('Loading items…');
    setItems([]);

    try {
      // 1) Items (variants with SKUs) by vendor from Shopify
      const itsRes = await fetch(
        `/api/shopify/items-by-supplier?supplierId=${encodeURIComponent(forSupplierId)}&limit=800` +
          (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''),
        { cache: 'no-store' }
      );
      const itsJson = await itsRes.json().catch(() => ({ ok: false }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const base: ItemRow[] = (itsJson.items as any[]).map((it: any) => {
        const cleanTitle = String(it.title || '').replace(/\s+—\s+Default Title$/i, '');
        return {
          sku: it.sku,
          title: cleanTitle,
          variantId: it.variantId || null,
          inventoryQuantity: toNum(it.inventoryQuantity),
          costAmount: toNum(it.costAmount),
          priceAmount: it.priceAmount == null ? null : toNum(it.priceAmount),
          orderQty: 0,
        };
      });

      if (!base.length) {
        setItems([]);
        setStatus('No items found for this supplier.');
        return;
      }

      setItems(base);
      setStatus(`Loaded ${base.length} item(s). Getting sales…`);

      // 2) Sales 30/60 + custom by SKU
      const skus = base.map((r) => r.sku).filter(Boolean).slice(0, 800);
      if (skus.length) {
        const salesRes = await fetch('/api/shopify/sales-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skus,
            locationId: locationId || undefined,
            days30: true,
            days60: true,
            days: lookbackDays,
            countPaidIfNoFulfillments: includePaidFallback,
          }),
        });
        const salesJson = await salesRes.json().catch(() => ({ ok: false }));
        if (!salesJson?.ok) throw new Error(salesJson?.error || 'Failed to fetch sales');

        let merged = base.map((r) => ({
          ...r,
          sales30: toNum(salesJson.sales?.[r.sku]),
          sales60: toNum(salesJson.sales60?.[r.sku]),
          salesCustom: (lookbackDays !== 30 && lookbackDays !== 60)
            ? toNum(salesJson.custom?.totals?.[r.sku])
            : undefined,
        }));

        // 3) Optional: OOS days for the same custom window
        try {
          const oosRes = await fetch('/api/shopify/oos-days-by-sku', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skus, days: lookbackDays, locationId: locationId || undefined }),
          });
          const oosJson = await oosRes.json().catch(() => ({ ok: false }));
          if (oosJson?.ok && oosJson.days) {
            merged = merged.map((r) => ({ ...r, oosDays: toNum(oosJson.days[r.sku]) }));
          }
        } catch { /* optional */ }

        setItems(recalcDerived(merged, lookbackDays, daysOfStock));
        setStatus(`${salesJson.source || 'ShopifyOrders'} (${lookbackDays}d)`);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  // Auto-refresh on key changes
  useEffect(() => {
    if (supplierId) fetchPlan(supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, locationId, includePaidFallback, lookbackDays, daysOfStock]);

  // Sorting
  const [sortBy, setSortByState] = useState<SortKey>('sku'); // keep state name explicit if needed elsewhere
  useEffect(() => setSortByState(sortBy), [sortBy]); // keep in sync

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
  const grandTotal = useMemo(
    () => items.reduce((acc, r) => acc + toNum(r.costAmount) * toNum(r.orderQty), 0),
    [items]
  );

  // Hide the “custom” column if lookback matches 30 or 60 (prevents duplicate)
  const showCustomCol = lookbackDays !== 30 && lookbackDays !== 60;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Ordering</h1>
        <span className="text-sm text-gray-500">Forecast demand &amp; create POs (Shopify)</span>
      </div>

      {/* Controls (neutral styling; no pink) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="flex flex-col text-sm">
          Days of stock
          <input
            type="number"
            className="border rounded p-2"
            min={0}
            value={daysOfStock}
            onChange={(e) => setDaysOfStock(Math.max(0, Number(e.target.value || 0)))}
          />
        </label>

        <label className="flex flex-col text-sm">
          Lookback (days)
          <input
            type="number"
            className="border rounded p-2"
            min={1}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Math.max(1, Number(e.target.value || 0)))}
          />
        </label>

        <label className="flex flex-col text-sm">
          Location
          <select
            className="border rounded p-2"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All</option>
            {locations.map((l) => (
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
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col justify-center text-sm">
          <span className="mb-1">Options</span>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-black"
              checked={includePaidFallback}
              onChange={(e) => setIncludePaidFallback(e.target.checked)}
            />
            Count paid orders if no fulfillments
          </label>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={!supplierId || loading}
          onClick={() => fetchPlan(supplierId)}
        >
          {loading ? 'Loading…' : 'Generate plan'}
        </button>
        {!!status && <span className="text-xs text-gray-600">{status}</span>}
        {hasRows && (
          <span className="ml-auto text-sm text-gray-700">
            Total cost: <span className="font-semibold">£{fmt2(grandTotal)}</span>
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 text-sm rounded bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Table (clean, bordered, zebra rows, sticky neutral header) */}
      <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10">
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 text-left">
                <button className="font-medium hover:underline hover:text-gray-900" onClick={() => toggleSort('sku')}>
                  SKU <Caret k="sku" />
                </button>
              </th>
              <th className="px-3 py-2 text-left">
                <button className="font-medium hover:underline hover:text-gray-900" onClick={() => toggleSort('title')}>
                  Product <Caret k="title" />
                </button>
              </th>
              <th className="px-3 py-2 text-right">In stock</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">
                <button className="font-medium hover:underline hover:text-gray-900" onClick={() => toggleSort('sales30')}>
                  30 days <Caret k="sales30" />
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button className="font-medium hover:underline hover:text-gray-900" onClick={() => toggleSort('sales60')}>
                  60 days <Caret k="sales60" />
                </button>
              </th>
              {showCustomCol && (
                <th className="px-3 py-2 text-right">
                  <button
                    className="font-medium hover:underline hover:text-gray-900"
                    onClick={() => toggleSort('salesCustom')}
                  >
                    {lookbackDays} days <Caret k="salesCustom" />
                  </button>
                </th>
              )}
              <th className="px-3 py-2 text-right">
                <button className="font-medium hover:underline hover:text-gray-900" onClick={() => toggleSort('oosDays')}>
                  Days OOS <Caret k="oosDays" />
                </button>
              </th>
              <th className="px-3 py-2 text-right">Avg/day</th>
              <th className="px-3 py-2 text-right">Forecast</th>
              <th className="px-3 py-2 text-right">
                <button
                  className="font-medium hover:underline hover:text-gray-900"
                  onClick={() => toggleSort('suggestedQty')}
                >
                  Suggested <Caret k="suggestedQty" />
                </button>
              </th>
              <th className="px-3 py-2 text-right">Order qty</th>
              <th className="px-3 py-2 text-right">Line total</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {!hasRows && (
              <tr>
                <td className="px-3 py-3" colSpan={showCustomCol ? 13 : 12}>
                  Pick a supplier and click “Generate plan”…
                </td>
              </tr>
            )}

            {sorted.map((r) => {
              const cost = toNum(r.costAmount);
              const lineTotal = cost * toNum(r.orderQty);
              return (
                <tr key={r.sku} className="odd:bg-white even:bg-gray-50 hover:bg-gray-100/70 transition-colors">
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">{r.sku}</td>
                  <td className="px-3 py-3">{r.title}</td>
                  <td className="px-3 py-3 text-right">{toNum(r.inventoryQuantity)}</td>
                  <td className="px-3 py-3 text-right">{cost ? fmt2(cost) : '—'}</td>
                  <td className="px-3 py-3 text-right">{toNum(r.sales30)}</td>
                  <td className="px-3 py-3 text-right">{toNum(r.sales60)}</td>
                  {showCustomCol && (
                    <td className="px-3 py-3 text-right">{toNum(r.salesCustom)}</td>
                  )}
                  <td className="px-3 py-3 text-right">{toNum(r.oosDays)}</td>
                  <td className="px-3 py-3 text-right">{(r.avgDaily ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{Math.ceil(r.forecastQty ?? 0)}</td>
                  <td className="px-3 py-3 text-right">{toNum(r.suggestedQty)}</td>
                  <td className="px-3 py-3 text-right">
                    <input
                      type="number"
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right focus:border-gray-500 focus:outline-none"
                      value={r.orderQty}
                      min={0}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value || 0));
                        setItems((prev) => prev.map((x) => (x.sku === r.sku ? { ...x, orderQty: v } : x)));
                      }}
                    />
                  </td>
                  <td className="px-3 py-3 text-right">{lineTotal ? fmt2(lineTotal) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Sales are counted from Shopify fulfillments; if enabled, paid orders are used when no fulfillments exist. Avg/day
        divides sales by the effective days (lookback minus out-of-stock days).
      </p>
    </div>
  );
}
