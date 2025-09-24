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

type SortKey = 'sku' | 'title' | 'sales30' | 'sales60';
type SortDir = 'asc' | 'desc';

export default function PurchaseOrderingPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [supplierId, setSupplierId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Load dropdowns
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const [sRes, lRes] = await Promise.all([
          fetch('/api/lw/suppliers', { cache: 'no-store' }),
          fetch('/api/lw/locations', { cache: 'no-store' }),
        ]);
        const sJson = await sRes.json().catch(() => ({ ok: false }));
        const lJson = await lRes.json().catch(() => ({ ok: false }));

        if (sJson?.ok) setSuppliers(sJson.suppliers ?? []);
        if (lJson?.ok) setLocations(lJson.locations ?? []);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  function toggleSort(k: SortKey) {
    setSortKey(prev => (prev === k ? prev : k));
    setSortDir(prev => (sortKey === k ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
  }

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const va = ((): number | string => {
        switch (sortKey) {
          case 'sku': return a.sku || '';
          case 'title': return a.title || '';
          case 'sales30': return a.sales30 ?? -Infinity;
          case 'sales60': return a.sales60 ?? -Infinity;
        }
      })();
      const vb = ((): number | string => {
        switch (sortKey) {
          case 'sku': return b.sku || '';
          case 'title': return b.title || '';
          case 'sales30': return b.sales30 ?? -Infinity;
          case 'sales60': return b.sales60 ?? -Infinity;
        }
      })();

      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = Number(va), nb = Number(vb);
      return sortDir === 'asc' ? na - nb : nb - na;
    });
    return arr;
  }, [items, sortKey, sortDir]);

  async function fetchPlan(forSupplierId: string) {
    if (!forSupplierId) return;
    setLoading(true);
    setError(null);
    setItems([]);

    try {
      // 1) Get items for this supplier
      const itsRes = await fetch(`/api/lw/items-by-supplier?supplierId=${encodeURIComponent(forSupplierId)}&limit=600`, {
        cache: 'no-store',
      });
      const itsJson = await itsRes.json().catch(() => ({ ok: false }));
      if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

      const baseRows: ItemRow[] = (itsJson.items as any[]).map(it => ({
        sku: it.sku,
        title: it.title || '',
        orderQty: 0,
      }));

      setItems(baseRows);

      // 2) Sales: 30/60 days via Stock/GetStockConsumption (server route)
      const skus = baseRows.map(r => r.sku).filter(Boolean).slice(0, 200);
      if (skus.length) {
        const salesRes = await fetch('/api/lw/sales-by-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus, days30: true, days60: true, locationId: locationId || undefined }),
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
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch when supplier changes
  useEffect(() => {
    if (supplierId) fetchPlan(supplierId);
  }, [supplierId, locationId]);

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
            <option value="">All</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={!supplierId || loading}
          onClick={() => fetchPlan(supplierId)}
        >
          {loading ? "Loading…" : "Generate plan"}
        </button>
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
              <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort('sku')}>
                SKU {sortKey === 'sku' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort('title')}>
                Product {sortKey === 'title' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="text-left p-3">Order qty</th>
              <th className="text-right p-3 cursor-pointer select-none" onClick={() => toggleSort('sales30')}>
                30 days sales {sortKey === 'sales30' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th className="text-right p-3 cursor-pointer select-none" onClick={() => toggleSort('sales60')}>
                60 days sales {sortKey === 'sales60' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {!hasRows && (
              <tr><td className="p-3" colSpan={5}>Pick a supplier and click “Generate plan”…</td></tr>
            )}
            {sorted.map((r) => (
              <tr key={r.sku}>
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
        * Sales figures come from Stock → GetStockConsumption (exact SKU match) over the last 30 / 60 days.
      </p>
    </div>
  );
}
