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

  oosDays?: number;             // days out of stock in lookback

  avgDaily?: number;
  forecastQty?: number;
  suggestedQty?: number;
  orderQty: number;
};

type SortKey = 'sku' | 'title' | 'sales30' | 'sales60' | 'oosDays' | 'suggestedQty';
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
  const fmt2 = (n: number | null | undefined) => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v.toFixed(2) : '0.00';
  };
  const fmtGBP = (n: number | null | undefined) => `£${fmt2(n)}`;

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
      // adjust effective days for any recorded OOS days (min 1 day to avoid divide-by-zero)
      const effectiveDays = Math.max(1, lbDays - Math.max(0, Number(r.oosDays ?? 0)));
      const salesForWindow = lbDays >= 45 ? Number(r.sales60 ?? 0) : Number(r.sales30 ?? 0);
      const avg = effectiveDays > 0 ? (salesForWindow / effectiveDays) : 0;

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

  // fetch items + sales (+ OOS) for a supplier
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

      // Sales (30/60) — drafts excluded at the API; count orders when no fulfillments
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
            // server defaults include paid & unpaid where appropriate; drafts excluded
            countPaidIfNoFulfillments: true
          }),
        });
        const salesJson = await salesRes.json().catch(() => ({ ok: false }));
        if (!salesJson?.ok) throw new Error(salesJson?.error || 'Failed to fetch sales');

        let merged = baseRows.map(r => ({
          ...r,
          sales30: Number(salesJson.sales?.[r.sku] ?? 0),
          sales60: Number(salesJson.sales60?.[r.sku] ?? 0),
        }));

        // Days OOS (prefer snapshots; fallback proxy)
        try {
          const oosRes = await fetch('/api/shopify/oos-days-by-sku', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skus, days: lookbackDays, locationId: locationId || undefined }),
          });
          const oosJson = await oosRes.json().catch(() => ({ ok: false }));
          if (oosJson?.ok && oosJson.days) {
            merged = merged.map(r => ({ ...r, oosDays: Number(oosJson.days[r.sku] ?? 0) }));
          }
        } catch { /* optional */ }

        setItems(recalcDerived(merged, lookbackDays, daysOfStock));
        setStatus(`${salesJson.source || 'ShopifyOrders'} (${lookbackDays}d)`);
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
  useEffect(() => { if (supplierId) fetchPlan(supplierId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplierId, locationId]);

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
    <div className="po-root">
      <div className="po-card po-controls">
        <div className="po-grid">
          <label className="po-field">
            <span>Days of stock</span>
            <input
              type="number" min={1}
              value={daysOfStock}
              onChange={(e) => setDaysOfStock(Math.max(1, Number(e.target.value || 0)))}
            />
          </label>

          <label className="po-field">
            <span>Look-back (days)</span>
            <input
              type="number" min={7}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Math.max(7, Number(e.target.value || 0)))}
            />
            <small>Uses the closest of 30/60d sales to estimate avg/day.</small>
          </label>

          <label className="po-field">
            <span>Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <label className="po-field">
            <span>Supplier</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <div className="po-actions">
            <button className="po-btn" disabled={!supplierId || loading} onClick={() => fetchPlan(supplierId)}>
              {loading ? "Loading…" : "Generate plan"}
            </button>
            <button className="po-btn po-btn--secondary" disabled={!hasRows} onClick={applySuggestedAll}>
              Auto-fill with Suggested
            </button>
            {!!status && <span className="po-status">Sales source: {status}</span>}
          </div>
        </div>
      </div>

      {error && <div className="po-error">{error}</div>}

      <div className="po-table-wrap">
        <table className="po-table">
          <thead>
            <tr>
              <th>
                <button className="po-th-link" onClick={() => toggleSort('sku')}>
                  SKU <Caret k="sku" />
                </button>
              </th>
              <th>
                <button className="po-th-link" onClick={() => toggleSort('title')}>
                  Product <Caret k="title" />
                </button>
              </th>
              <th className="ta-center">In stock</th>
              <th className="ta-center">Cost</th>
              <th className="ta-center">
                <button className="po-th-link" onClick={() => toggleSort('sales30')}>
                  30d sales <Caret k="sales30" />
                </button>
              </th>
              <th className="ta-center">
                <button className="po-th-link" onClick={() => toggleSort('sales60')}>
                  60d sales <Caret k="sales60" />
                </button>
              </th>
              <th className="ta-center">
                <button className="po-th-link" onClick={() => toggleSort('oosDays')}>
                  Days OOS <Caret k="oosDays" />
                </button>
              </th>
              <th className="ta-center">Avg/day</th>
              <th className="ta-center">Forecast</th>
              <th className="ta-center">
                <button className="po-th-link" onClick={() => toggleSort('suggestedQty')}>
                  Suggested <Caret k="suggestedQty" />
                </button>
              </th>
              <th className="ta-center">Order qty</th>
              <th className="ta-center">Line total</th>
            </tr>
          </thead>

          <tbody>
            {!hasRows && (
              <tr><td className="empty" colSpan={12}>Pick a supplier and click “Generate plan”…</td></tr>
            )}

            {sorted.map((r, idx) => {
              const costNum = Number(r.costAmount ?? 0);
              const lineTotal = costNum * Number(r.orderQty ?? 0);
              return (
                <tr key={r.sku} className={idx % 2 ? 'alt' : undefined}>
                  <td>{r.sku}</td>
                  <td>{r.title}</td>
                  <td className="ta-center">{r.inventoryQuantity ?? 0}</td>
                  <td className="ta-center">{costNum ? fmtGBP(costNum) : '—'}</td>
                  <td className="ta-center">{r.sales30 ?? 0}</td>
                  <td className="ta-center">{r.sales60 ?? 0}</td>
                  <td className="ta-center">{r.oosDays ?? 0}</td>
                  <td className="ta-center">{(r.avgDaily ?? 0).toFixed(2)}</td>
                  <td className="ta-center">{Math.ceil(r.forecastQty ?? 0)}</td>
                  <td className="ta-center">{r.suggestedQty ?? 0}</td>
                  <td className="ta-center">
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
                  <td className="ta-center">{lineTotal ? fmtGBP(lineTotal) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasRows && (
          <div className="po-table-foot">
            <div className="total">Grand total: {fmtGBP(grandTotal)}</div>
          </div>
        )}
      </div>

      {/* Scoped styles + global overrides to ensure full-width */}
      <style jsx>{`
        /* FULL-BLEED root that ignores any global max-width container */
        .po-root{
          width: 100vw;
          max-width: 100vw;
          margin-left: calc(50% - 50vw);
          margin-right: calc(50% - 50vw);
          padding: 24px;
        }

        .po-card {
          border: 1px solid #e5e7eb; background: #fff; border-radius: 12px;
          box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 14px;
        }

        .po-controls .po-grid {
          display: grid; grid-template-columns: repeat(12, minmax(0, 1fr));
          gap: 16px; padding: 16px;
          align-items: end;
        }
        .po-field { grid-column: span 3 / span 3; display: flex; flex-direction: column; font-size: 14px; color: #374151; }
        .po-field:nth-child(2){ grid-column: span 3 / span 3; }
        .po-field:nth-child(3){ grid-column: span 3 / span 3; }
        .po-field:nth-child(4){ grid-column: span 3 / span 3; }

        .po-field > span { font-weight: 500; }
        .po-field input, .po-field select {
          margin-top: 6px; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px;
          background: #fff; color: #111827; outline: none;
        }
        .po-field small { margin-top: 6px; color: #6b7280; font-size: 11px; }

        .po-actions { grid-column: 1 / -1; display:flex; align-items:center; gap: 10px; padding-top: 4px; }
        .po-btn {
          background:#111827; color:#fff; padding:8px 12px; border-radius:8px; border:1px solid #111827;
          font-weight: 600; cursor:pointer;
        }
        .po-btn:hover { background:#000; border-color:#000; }
        .po-btn:disabled { opacity:.5; cursor:not-allowed; }
        .po-btn--secondary { background:#fff; color:#111827; border:1px solid #d1d5db; }
        .po-btn--secondary:hover { background:#f9fafb; }
        .po-status { font-size:12px; color:#6b7280; margin-left: 8px; }

        .po-error {
          background:#fef2f2; color:#991b1b; border:1px solid #fecaca;
          padding:10px 12px; border-radius:8px; font-size:14px; margin-bottom: 12px;
        }

        .po-table-wrap {
          background:#fff; border:1px solid #e5e7eb; border-radius:12px;
          box-shadow: 0 1px 2px rgba(0,0,0,.04); overflow:hidden;
        }
        .po-table { width:100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
        .po-table thead th {
          position: sticky; top: 0; z-index: 5;
          background: #f9fafb; color:#374151; text-align:left; padding:12px; font-weight:600;
          border-bottom:1px solid #e5e7eb;
        }
        .po-th-link { all: unset; cursor: pointer; color:#374151; font-weight:600; }
        .po-th-link:hover { text-decoration: underline; }

        .po-table tbody td { padding:12px; color:#111827; border-bottom:1px solid #f3f4f6; vertical-align: middle; }
        .po-table tbody tr.alt td { background:#fafafa; }

        .ta-center { text-align: center; }

        .po-table .empty { padding: 16px; color:#6b7280; }

        .po-qty {
          width: 88px; padding: 8px 10px; text-align: center; border:1px solid #d1d5db; border-radius:8px;
          background:#fff; color:#111827; outline:none;
        }
        .po-qty:focus { box-shadow: 0 0 0 2px #9ca3af55; }

        .po-table-foot {
          display:flex; align-items:center; justify-content:flex-end;
          padding: 10px 12px; background:#fafafa; border-top:1px solid #e5e7eb; font-size:14px;
        }
        .po-table-foot .total { font-weight:600; color:#111827; }
      `}</style>

      <style jsx global>{`
        /* Neutralize app-level container caps on this page only */
        .po-root .container,
        .po-root .content,
        .po-root .wrap,
        .po-root [class*="max-w"] {
          max-width: none !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
      `}</style>
    </div>
  );
}
