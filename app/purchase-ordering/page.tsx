'use client';

import { useEffect, useState } from 'react';

type Supplier = { id: string; name: string };
type Location = { id: string; name: string; tag?: string | null };
type ItemRow = {
  sku: string;
  title: string;
  orderQty: number;
  sales30?: number;
  sales60?: number;
};

export default function PurchaseOrderingPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Load dropdowns (suppliers + locations)
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const [sRes, lRes] = await Promise.all([
          fetch('/api/lw/suppliers', { cache: 'no-store' }),
          fetch('/api/lw/locations', { cache: 'no-store' }),
        ]);

        const sJson = await sRes.json().catch(() => ({ ok: false, error: 'suppliers non-JSON' }));
        const lJson = await lRes.json().catch(() => ({ ok: false, error: 'locations non-JSON' }));

        if (sJson?.ok && Array.isArray(sJson.suppliers)) {
          setSuppliers(sJson.suppliers);
        } else if (!sJson?.ok) {
          setError((prev) => (prev ? prev + ' | ' : '') + (sJson?.error || 'Failed to load suppliers'));
        }

        if (lJson?.ok && Array.isArray(lJson.locations)) {
          setLocations(lJson.locations);
          // Optional: preselect default location if one exists
          const def = lJson.locations.find((l: Location) => (l as any).isDefault || (l as any).IsDefault)?.id;
          if (def) setLocationId(def);
        } else if (!lJson?.ok) {
          setError((prev) => (prev ? prev + ' | ' : '') + (lJson?.error || 'Failed to load locations'));
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  // Clear table when supplier changes
  useEffect(() => {
    setItems([]);
    setError(null);
    setStatus(null);
    if (supplierId) {
      // Auto-fetch on change; the button can be used to re-run.
      fetchPlan(supplierId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  async function fetchPlan(forSupplierId: string) {
    if (!forSupplierId) return;
    setLoading(true);
    setError(null);
    setStatus('Loading items…');
    setItems([]);

    try {
      // Items for this supplier
      const itsRes = await fetch(
        `/api/lw/items-by-supplier?supplierId=${encodeURIComponent(forSupplierId)}&limit=800`,
        { cache: 'no-store' }
      );
      const itsJson = await itsRes.json().catch(() => ({ ok: false, error: 'Items endpoint returned non-JSON' }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const baseRows: ItemRow[] = (itsJson.items as any[]).map((it) => ({
        sku: it.sku,
        title: it.title || '',
        orderQty: 0,
      }));

      if (baseRows.length === 0) {
        setItems([]);
        setStatus('No items found for this supplier.');
        return;
      }

      setItems(baseRows);
      setStatus(`Loaded ${baseRows.length} items. Loading sales…`);

      // Sales: 30/60 days
      const skus = baseRows.map((r) => r.sku).filter(Boolean).slice(0, 400); // safety cap
      if (skus.length) {
        const salesRes = await fetch('/api/lw/sales-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus, days30: true, days60: true }),
        });
        const salesJson = await salesRes.json().catch(() => ({ ok: false, error: 'Sales endpoint returned non-JSON' }));
        if (!salesJson?.ok) throw new Error(salesJson?.error || 'Failed to fetch sales');

        const bySku: Record<string, { d30?: number; d60?: number }> = salesJson.sales || {};
        setItems((prev) =>
          prev.map((r) => ({
            ...r,
            sales30: bySku[r.sku]?.d30 ?? 0,
            sales60: bySku[r.sku]?.d60 ?? 0,
          }))
        );
      }

      setStatus('Done.');
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  const hasRows = items.length > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Ordering</h1>
        <span className="text-sm text-gray-500">Forecast demand &amp; create POs</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col text-sm">
          Horizon (days)
          <input type="number" defaultValue={14} className="border rounded p-2" />
        </label>

        <label className="flex flex-col text-sm">
          Lookback (days)
          <input type="number" defaultValue={60} className="border rounded p-2" />
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
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
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
            <option value="">All</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
        {status && <span className="text-sm text-gray-600">{status}</span>}
      </div>

      {error && (
        <div className="p-3 text-sm rounded bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <div className="border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">SKU</th>
              <th className="text-left p-3">Product</th>
              <th className="text-left p-3">Order qty</th>
              <th className="text-right p-3">30 days sales</th>
              <th className="text-right p-3">60 days sales</th>
            </tr>
          </thead>
          <tbody>
            {!hasRows && (
              <tr>
                <td className="p-3" colSpan={5}>
                  Pick a supplier and click “Generate plan”…
                </td>
              </tr>
            )}
            {items.map((r) => (
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
                      setItems((prev) => prev.map((x) => (x.sku === r.sku ? { ...x, orderQty: v } : x)));
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
        * Sales figures come from Processed Orders (exact SKU match) over the last 30 / 60 days.
      </p>
    </div>
  );
}
