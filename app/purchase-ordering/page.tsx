'use client';

import { useEffect, useMemo, useState } from 'react';

type Supplier = { id: string; name: string };
type Location = { id: string; name: string; tag?: string | null };

type ItemRow = {
  sku: string;
  title: string;
  variantId?: string | null;

  inventoryQuantity?: number;      // on-hand
  costAmount?: number;             // unit cost
  priceAmount?: number | null;

  sales30?: number;
  sales60?: number;
  salesCustom?: number;
  oosDays?: number;

  avgDaily?: number;
  forecastQty?: number;
  suggestedQty?: number;

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

/* ---------- helpers ---------- */
function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'object') {
    if ('amount' in (v as any)) return toNum((v as any).amount);
    if ('available' in (v as any)) return toNum((v as any).available);
  }
  return 0;
}
const fmt2 = (n?: number | null) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00';

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
  return rows.map((r) => {
    const avg =
      typeof r.salesCustom === 'number'
        ? (lbDays > 0 ? r.salesCustom! / lbDays : 0)
        : nearestBucketRate(r, lbDays);

    const forecast = avg * Math.max(0, horizon || 0);
    const onHand = toNum(r.inventoryQuantity);
    const suggested = Math.max(0, Math.ceil(forecast - onHand));
    return { ...r, avgDaily: avg, forecastQty: forecast, suggestedQty: suggested };
  });
}

/* ---------- component ---------- */
export default function PurchaseOrderingPage() {
  // dropdowns
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // selections
  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [daysOfStock, setDaysOfStock] = useState<number>(14);
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [includePaidFallback, setIncludePaidFallback] = useState<boolean>(true);

  // ui
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  // sorting
  const [sortBy, setSortBy] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(k);
      setSortDir('asc');
    }
  };
  const Caret = ({ k }: { k: SortKey }) =>
    sortBy === k ? (
      <span className="ml-1 text-gray-500">{sortDir === 'asc' ? '▲' : '▼'}</span>
    ) : null;

  /* load dropdowns */
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

  /* fetch plan */
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
      // 1) Items (cost, stock, etc.)
      const itsRes = await fetch(
        `/api/shopify/items-by-supplier?supplierId=${encodeURIComponent(
          forSupplierId
        )}&limit=800` + (locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''),
        { cache: 'no-store' }
      );
      const itsJson = await itsRes.json().catch(() => ({ ok: false }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const base: ItemRow[] = (itsJson.items as any[]).map((it: any) => ({
        sku: it.sku,
        title: String(it.title || '').replace(/\s+—\s+Default Title$/i, ''),
        variantId: it.variantId || null,
        inventoryQuantity: toNum(it.inventoryQuantity),
        costAmount: toNum(it.costAmount),
        priceAmount: it.priceAmount == null ? null : toNum(it.priceAmount),
        orderQty: 0,
      }));

      if (!base.length) {
        setItems([]);
        setStatus('No items found for this supplier.');
        return;
      }

      setItems(base);
      setStatus(`Loaded ${base.length} item(s). Getting sales…`);

      // 2) Sales (30 / 60 / custom)
      const skus = base.map((r) => r.sku).filter(Boolean).slice(0, 800);
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

      const merged = base.map((r) => {
        const s30 =
          salesJson.sales?.[r.sku]?.d30 ??
          salesJson.sales30?.[r.sku] ??
          salesJson.d30?.[r.sku] ??
          0;
        const s60 =
          salesJson.sales?.[r.sku]?.d60 ??
          salesJson.sales60?.[r.sku] ??
          salesJson.d60?.[r.sku] ??
          0;
        const sc =
          salesJson.custom?.totals?.[r.sku] ??
          salesJson.custom?.[r.sku] ??
          0;

        return {
          ...r,
          sales30: toNum(s30),
          sales60: toNum(s60),
          salesCustom: toNum(sc),
        };
      });

      // 3) Optional OOS days
      let withOOS = merged;
      try {
        const oosRes = await fetch('/api/shopify/oos-days-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus, days: lookbackDays, locationId: locationId || undefined }),
        });
        const oosJson = await oosRes.json().catch(() => ({ ok: false }));
        if (oosJson?.ok && oosJson.days) {
          withOOS = merged.map((r) => ({ ...r, oosDays: toNum(oosJson.days[r.sku]) }));
        }
      } catch {
        // ignore if route not present
      }

      setItems(recalcDerived(withOOS, lookbackDays, daysOfStock));
      setStatus(`${salesJson.source || 'Shopify'} (${lookbackDays}d)`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  // auto-refresh on key controls
  useEffect(() => {
    if (supplierId) fetchPlan(supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, locationId, includePaidFallback]);

  // live recompute when these change
  useEffect(() => {
    setItems((prev) => recalcDerived(prev, lookbackDays, daysOfStock));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysOfStock, lookbackDays]);

  /* sorting + totals */
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

  const grandTotal = useMemo(
    () => items.reduce((acc, r) => acc + toNum(r.costAmount) * toNum(r.orderQty), 0),
    [items]
  );

  const hasRows = items.length > 0;

  return (
    <div className="max-w-[1200px] mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Ordering</h1>
        <span className="text-sm text-gray-500">Forecast demand &amp; create POs (Shopify)</span>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <label className="text-sm flex flex-col">
          Days of stock
          <input
            type="number"
            className="border rounded-lg p-2"
            min={0}
            value={daysOfStock}
            onChange={(e) => setDaysOfStock(Math.max(0, Number(e.target.value || 0)))}
          />
        </label>

        <label className="text-sm flex flex-col">
          Lookback (days)
          <input
            type="number"
            className="border rounded-lg p-2"
            min={1}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Math.max(1, Number(e.target.value || 0)))}
          />
        </label>

        <label className="text-sm flex flex-col">
          Location
          <select
            className="border rounded-lg p-2"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm flex flex-col">
          Supplier
          <select
            className="border rounded-lg p-2"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-4">
        <button
          className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
          disabled={!supplierId || loading}
          onClick={() => fetchPlan(supplierId)}
        >
          {loading ? 'Loading…' : 'Generate plan'}
        </button>

        <button
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 disabled:opacity-50"
          disabled={!hasRows}
          onClick={() =>
            setItems((prev) =>
              prev.map((r) => ({ ...r, orderQty: Math.max(0, toNum(r.suggestedQty)) }))
            )
          }
        >
          Auto-fill with Suggested
        </button>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-black"
            checked={includePaidFallback}
            onChange={(e) => setIncludePaidFallback(e.target.checked)}
          />
          Count paid orders if no fulfillments
        </label>

        {!!status && <span className="text-xs text-gray-600">Sales source: {status}</span>}
      </div>

      {error && (
        <div className="p-3 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-gray-700">
              <Th onClick={() => toggleSort('sku')} active={sortBy === 'sku'} dir={sortDir}>
                SKU
              </Th>
              <Th onClick={() => toggleSort('title')} active={sortBy === 'title'} dir={sortDir}>
                Product
              </Th>
              <ThRight>In stock</ThRight>
              <ThRight>Cost</ThRight>
              <ThRight>
                <SortBtn onClick={() => toggleSort('sales30')} active={sortBy === 'sales30'} dir={sortDir}>
                  30d sales
                </SortBtn>
              </ThRight>
              <ThRight>
                <SortBtn onClick={() => toggleSort('sales60')} active={sortBy === 'sales60'} dir={sortDir}>
                  60d sales
                </SortBtn>
              </ThRight>
              <ThRight>
                <SortBtn
                  onClick={() => toggleSort('salesCustom')}
                  active={sortBy === 'salesCustom'}
                  dir={sortDir}
                >
                  {lookbackDays}d sales
                </SortBtn>
              </ThRight>
              <ThRight>
                <SortBtn onClick={() => toggleSort('oosDays')} active={sortBy === 'oosDays'} dir={sortDir}>
                  Days OOS
                </SortBtn>
              </ThRight>
              <ThRight>Avg/day</ThRight>
              <ThRight>Forecast</ThRight>
              <ThRight>
                <SortBtn
                  onClick={() => toggleSort('suggestedQty')}
                  active={sortBy === 'suggestedQty'}
                  dir={sortDir}
                >
                  Suggested
                </SortBtn>
              </ThRight>
              <ThRight>Order qty</ThRight>
              <ThRight>Line total</ThRight>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {!items.length && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={13}>
                  Pick a supplier and click “Generate plan”…
                </td>
              </tr>
            )}

            {sorted.map((r, i) => {
              const cost = toNum(r.costAmount);
              const lineTotal = cost * toNum(r.orderQty);
              return (
                <tr key={r.sku} className={i % 2 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="p-3">{r.sku}</td>
                  <td className="p-3">{r.title}</td>
                  <td className="p-3 text-right">{toNum(r.inventoryQuantity)}</td>
                  <td className="p-3 text-right">{cost ? fmt2(cost) : '—'}</td>
                  <td className="p-3 text-right">{toNum(r.sales30)}</td>
                  <td className="p-3 text-right">{toNum(r.sales60)}</td>
                  <td className="p-3 text-right">{toNum(r.salesCustom)}</td>
                  <td className="p-3 text-right">{toNum(r.oosDays)}</td>
                  <td className="p-3 text-right">{(r.avgDaily ?? 0).toFixed(2)}</td>
                  <td className="p-3 text-right">{Math.ceil(r.forecastQty ?? 0)}</td>
                  <td className="p-3 text-right">{toNum(r.suggestedQty)}</td>
                  <td className="p-3 text-right">
                    <input
                      type="number"
                      className="w-24 p-2 border rounded-lg text-right"
                      value={r.orderQty}
                      min={0}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value || 0));
                        setItems((prev) => prev.map((x) => (x.sku === r.sku ? { ...x, orderQty: v } : x)));
                      }}
                    />
                  </td>
                  <td className="p-3 text-right">{lineTotal ? fmt2(lineTotal) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-right text-sm text-gray-700">
        <span className="font-medium">Grand total:</span> £{fmt2(grandTotal)}
      </div>

      <p className="text-xs text-gray-500">
        Sales are counted from Shopify <em>Fulfillments</em> (net shipped units). If enabled, paid order quantities are
        counted when there are no fulfillments (only when “All” locations is selected).
      </p>
    </div>
  );
}

/* small presentational helpers */
function Th({
  children,
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
}) {
  return (
    <th className="p-3 text-left font-semibold">
      {onClick ? (
        <button onClick={onClick} className="hover:underline">
          {children} {active ? <span className="text-gray-500">{dir === 'asc' ? '▲' : '▼'}</span> : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}
function ThRight(props: any) {
  return <th className="p-3 text-right font-semibold" {...props} />;
}
function SortBtn({
  children,
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
}) {
  return (
    <button onClick={onClick} className="hover:underline">
      {children} {active ? <span className="text-gray-500">{dir === 'asc' ? '▲' : '▼'}</span> : null}
    </button>
  );
}
