// app/purchase-ordering/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

type Supplier = { id: string; name: string };
type Location = { id: string; name: string; tag?: string | null };

type ItemRow = {
  sku: string;
  title: string;
  variantId?: string | null;

  inventoryQuantity?: number;   // on-hand (NUMBER ONLY)
  costAmount?: number;          // unit cost (NUMBER ONLY)
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

type SortKey = 'sku' | 'title' | 'sales30' | 'sales60' | 'salesCustom' | 'oosDays' | 'suggestedQty';
type SortDir = 'asc' | 'desc';

// --- NEW: small coercion helper so we never render objects ---
function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  // MoneyV2 or level-like objects
  if (typeof v === 'object') {
    // common shapes we might get back
    if ('amount' in v) return toNum((v as any).amount);
    if ('available' in v) return toNum((v as any).available);
  }
  return 0;
}

export default function PurchaseOrderingPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [daysOfStock, setDaysOfStock] = useState<number>(14);
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [includePaidFallback, setIncludePaidFallback] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const [sortBy, setSortBy] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(k); setSortDir('asc'); }
  };
  const Caret = ({ k }: { k: SortKey }) =>
    sortBy === k ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

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

  async function fetchPlan(forSupplierId: string) {
    if (!forSupplierId) { setError('Please choose a supplier'); return; }
    setLoading(true);
    setError(null);
    setStatus('Loading items…');
    setItems([]);

    try {
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
          // --- force numbers so React never sees objects ---
          inventoryQuantity: toNum(it.inventoryQuantity),
          costAmount: toNum(it.costAmount),
          priceAmount: it.priceAmount == null ? null : toNum(it.priceAmount),
          orderQty: 0,
        };
      });

      if (!base.length) { setItems([]); setStatus('No items found for this supplier.'); return; }

      setItems(base);
      setStatus(`Loaded ${base.length} item(s). Getting sales…`);

      const skus = base.map(r => r.sku).filter(Boolean).slice(0, 800);

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

      const merged = base.map(r => ({
        ...r,
        sales30: toNum(salesJson.sales?.[r.sku]),
        sales60: toNum(salesJson.sales60?.[r.sku]),
        salesCustom: salesJson.custom?.totals ? toNum(salesJson.custom.totals[r.sku]) : undefined,
      }));

      let withOOS = merged;
      try {
        const oosRes = await fetch('/api/shopify/oos-days-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus, days: lookbackDays, locationId: locationId || undefined }),
        });
        const oosJson = await oosRes.json().catch(() => ({ ok: false }));
        if (oosJson?.ok && oosJson.days) {
          withOOS = merged.map(r => ({ ...r, oosDays: toNum(oosJson.days[r.sku]) }));
        }
      } catch { /* optional */ }

      setItems(recalcDerived(withOOS, lookbackDays, daysOfStock));
      setStatus(`${salesJson.source || 'ShopifyOrders'} (${lookbackDays}d)`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (supplierId) fetchPlan(supplierId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplierId, locationId, includePaidFallback]);
  useEffect(() => { setItems(prev => recalcDerived(prev, lookbackDays, daysOfStock)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [daysOfStock, lookbackDays]);

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
  const grandTotal = useMemo(() => items.reduce((acc, r) => acc + (toNum(r.costAmount) * toNum(r.orderQty)), 0), [items]);

  const CaretLink = ({k,label}:{k:SortKey,label:string}) => (
    <button className="po-th-link" onClick={() => toggleSort(k)}>
      {label} <Caret k={k}/>
    </button>
  );

  return (
    <div className="po-wrap">
      {/* controls trimmed for brevity — keep whatever you already have */}
      {/* … your controls + buttons … */}

      {error && <div className="po-error">{error}</div>}

      <div className="po-table-wrap">
        <table className="po-table">
          <thead>
            <tr>
              <th><CaretLink k="sku" label="SKU"/></th>
              <th><CaretLink k="title" label="Product"/></th>
              <th className="ta-right">In stock</th>
              <th className="ta-right">Cost</th>
              <th className="ta-right"><CaretLink k="sales30" label="30d sales"/></th>
              <th className="ta-right"><CaretLink k="sales60" label="60d sales"/></th>
              <th className="ta-right"><CaretLink k="salesCustom" label={`${lookbackDays}d sales`}/></th>
              <th className="ta-right"><CaretLink k="oosDays" label="Days OOS"/></th>
              <th className="ta-right">Avg/day</th>
              <th className="ta-right">Forecast</th>
              <th className="ta-right"><CaretLink k="suggestedQty" label="Suggested"/></th>
              <th className="ta-right">Order qty</th>
              <th className="ta-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {!hasRows && (
              <tr><td className="empty" colSpan={13}>Pick a supplier and click “Generate plan”…</td></tr>
            )}
            {sorted.map((r, i) => {
              const cost = toNum(r.costAmount);
              const lineTotal = cost * toNum(r.orderQty);
              return (
                <tr key={r.sku} className={i % 2 ? 'alt' : undefined}>
                  <td>{r.sku}</td>
                  <td>{r.title}</td>
                  <td className="ta-right">{toNum(r.inventoryQuantity)}</td>
                  <td className="ta-right">{cost ? fmt(cost) : '—'}</td>
                  <td className="ta-right">{toNum(r.sales30)}</td>
                  <td className="ta-right">{toNum(r.sales60)}</td>
                  <td className="ta-right">{toNum(r.salesCustom)}</td>
                  <td className="ta-right">{toNum(r.oosDays)}</td>
                  <td className="ta-right">{(r.avgDaily ?? 0).toFixed(2)}</td>
                  <td className="ta-right">{Math.ceil(r.forecastQty ?? 0)}</td>
                  <td className="ta-right">{toNum(r.suggestedQty)}</td>
                  <td className="ta-right">
                    <input
                      type="number"
                      className="po-qty"
                      value={r.orderQty}
                      min={0}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value || 0));
                        setItems(prev => prev.map(x => x.sku === r.sku ? { ...x, orderQty: v } : x));
                      }}
                    />
                  </td>
                  <td className="ta-right">{lineTotal ? fmt(lineTotal) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .po-wrap{padding:24px;max-width:1200px;margin:0 auto;}
        .po-error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;padding:10px 12px;border-radius:8px;margin:12px 0}
        .po-table-wrap{background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04);overflow:hidden}
        .po-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
        .po-table thead th{position:sticky;top:0;background:#f9fafb;color:#374151;text-align:left;padding:12px;font-weight:600;border-bottom:1px solid #e5e7eb}
        .po-table tbody td{padding:12px;color:#111827;border-bottom:1px solid #f3f4f6}
        .po-table tbody tr.alt td{background:#fafafa}
        .po-th-link{all:unset;cursor:pointer;color:#374151;font-weight:600}
        .po-th-link:hover{text-decoration:underline}
        .ta-right{text-align:right}
        .po-qty{width:92px;padding:8px 10px;text-align:right;border:1px solid #d1d5db;border-radius:8px}
      `}</style>
    </div>
  );
}
