'use client';

import { useEffect, useMemo, useState } from 'react';
import { suggestQty } from '@/lib/forecast';

export const dynamic = 'force-dynamic';

type Location = { LocationId: string; LocationName: string; IsDefault: boolean };
type Supplier = { Id: string; Name: string };

type StockFull = {
  StockItemId: string;
  ItemNumber: string; // SKU
  ItemTitle: string;
  StockLevels: { LocationId: string; StockLevel: number; InOrderBook: number; Due: number }[];
  Suppliers?: {
    SupplierId: string;
    SupplierName: string;
    SupplierMinOrderQty?: number;
    SupplierPackSize?: number;
    PurchasePrice?: number;
    SupplierCurrency?: string;
    LeadTime?: number;
  }[];
};

export default function PurchaseOrderingPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [skuText, setSkuText] = useState('');
  const [horizon, setHorizon] = useState(14);
  const [lookback, setLookback] = useState(60);
  const [locationId, setLocationId] = useState<string>('ALL');
  const [supplierId, setSupplierId] = useState<string>('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setErrorMsg(null);
      try {
        const [locRes, supRes] = await Promise.all([
          fetch('/api/lw/locations').then(r => r.json()).catch(e => ({ ok: false, error: e?.message })),
          fetch('/api/lw/suppliers').then(r => r.json()).catch(e => ({ ok: false, error: e?.message })),
        ]);

        if (!locRes?.ok) {
          console.error('Locations error', locRes);
          setErrorMsg(locRes?.error || 'Failed to load locations');
          setLocations([]);
        } else {
          setLocations(locRes.locations || []);
          const def = (locRes.locations || []).find((l: Location) => l.IsDefault)?.LocationId;
          setLocationId(def || 'ALL');
        }

        if (!supRes?.ok) {
          console.error('Suppliers error', supRes);
          setErrorMsg(prev => prev ? prev + ' | ' + (supRes?.error || 'Failed to load suppliers') : (supRes?.error || 'Failed to load suppliers'));
          setSuppliers([]);
        } else {
          setSuppliers(supRes.suppliers || []);
        }
      } catch (e: any) {
        console.error('Lookup load failed', e);
        setErrorMsg(e?.message || 'Failed to load lookups');
      }
    })();
  }, []);

  async function loadPlan() {
    setErrorMsg(null);
    setLoading(true);
    try {
      const skus = skuText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      if (!skus.length) throw new Error('Enter one or more SKUs (comma or newline separated).');

      const idMap = await fetch('/api/lw/stock/ids-by-sku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      }).then(async r => {
        const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error('IDs-by-SKU returned non-JSON: ' + t.slice(0,200)); }
      });

      const stockItemIds = (idMap || []).map((x: any) => x?.StockItemId).filter(Boolean);
      if (!stockItemIds.length) throw new Error('No matching Linnworks items for those SKUs.');

      const full = await fetch('/api/lw/stock/full', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemIds, withSuppliers: true }),
      }).then(async r => {
        const t = await r.text(); try { return JSON.parse(t) as StockFull[]; } catch { throw new Error('Stock/full returned non-JSON: ' + t.slice(0,200)); }
      });

      const to = new Date();
      const from = new Date(to.getTime() - lookback * 24 * 3600 * 1000);
      const sales = await fetch('/api/lw/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromISO: from.toISOString(), toISO: to.toISOString(), skuList: skus }),
      }).then(async r => {
        const t = await r.text(); try { return JSON.parse(t); } catch { return { Data: [] }; }
      });

      const totalsBySku: Record<string, number> = {};
      for (const o of sales?.Data || []) {
        for (const it of o?.Items || []) {
          const sku = it?.SKU ?? it?.ItemNumber ?? it?.ItemTitle;
          const qty = Number(it?.Quantity) || 0;
          if (!sku) continue;
          totalsBySku[sku] = (totalsBySku[sku] || 0) + qty;
        }
      }
      const avgBySku: Record<string, number> = {};
      Object.entries(totalsBySku).forEach(([sku, qty]) => {
        avgBySku[sku] = Number(qty) / Math.max(1, lookback);
      });

      const out: any[] = [];
      for (const item of full) {
        const sku = item.ItemNumber;
        const level = (item.StockLevels || []).find(l => locationId === 'ALL' ? true : l.LocationId === locationId)
          || { StockLevel: 0, InOrderBook: 0, Due: 0 };

        const sup = (item.Suppliers || [])[0];
        if (supplierId !== 'ALL' && sup?.SupplierId !== supplierId) continue;

        const avgDaily = avgBySku[sku] ?? 0;
        const lead = Number(sup?.LeadTime) || 7;
        const pack = Number(sup?.SupplierPackSize) || undefined;
        const moq = Number(sup?.SupplierMinOrderQty) || undefined;
        const unitCost = Number(sup?.PurchasePrice) || 0;

        const s = suggestQty({
          avgDaily,
          leadTimeDays: lead,
          reviewDays: 7,
          bufferDays: 0,
          serviceZ: 1.64,
          horizonDays: horizon,
          onHand: Number(level.StockLevel) || 0,
          inOrderBook: Number(level.InOrderBook) || 0,
          due: Number(level.Due) || 0,
          packSize: pack,
          moq,
        });

        out.push({
          stockItemId: item.StockItemId,
          sku,
          title: item.ItemTitle,
          supplierId: sup?.SupplierId || null,
          supplierName: sup?.SupplierName || '—',
          onHand: level.StockLevel || 0,
          inOrderBook: level.InOrderBook || 0,
          due: level.Due || 0,
          avgDaily: Number(avgDaily.toFixed(2)),
          suggested: s.qty,
          unitCost,
          extended: Number((unitCost * s.qty).toFixed(2)),
        });
      }

      setRows(out);
    } catch (e: any) {
      console.error('Plan generation failed', e);
      setErrorMsg(e?.message || 'Failed to generate plan');
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of rows) {
      const key = (r.supplierId || 'unknown') + '|' + (r.supplierName || 'Unknown');
      (g[key] ||= []).push(r);
    }
    return g;
  }, [rows]);

  async function createPOForGroup(key: string) {
    const [sid, sname] = key.split('|');
    const lines = (grouped[key] || []).map(r => ({
      stockItemId: r.stockItemId,
      qty: r.suggested,
      unitCost: r.unitCost || 0,
    })).filter(l => l.qty > 0);
    if (!lines.length) return alert('No positive suggested qty for this group.');

    const currency = 'GBP';
    const deliveryDateISO = new Date(Date.now() + 7 * 86400000).toISOString();
    const resp = await fetch('/api/lw/pos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: sid === 'unknown' ? null : sid,
        locationId: locationId === 'ALL'
          ? (locations.find(l => l.IsDefault)?.LocationId || '')
          : locationId,
        currency, deliveryDateISO, lines,
      }),
    }).then(r => r.json()).catch(e => ({ error: e?.message }));

    if (resp?.error) alert('PO create failed: ' + resp.error);
    else alert(`Created PO ${resp.purchaseId} for ${sname} with ${resp.count} lines`);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Ordering</h1>
        <span className="text-sm text-gray-500">Forecast demand &amp; create POs</span>
      </div>

      {errorMsg && <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{errorMsg}</div>}

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="flex flex-col text-sm">
          Horizon (days)
          <input type="number" value={horizon} onChange={e=>setHorizon(parseInt(e.target.value||'0'))} className="border rounded p-2" />
        </label>
        <label className="flex flex-col text-sm">
          Lookback (days)
          <input type="number" value={lookback} onChange={e=>setLookback(parseInt(e.target.value||'0'))} className="border rounded p-2" />
        </label>
        <label className="flex flex-col text-sm">
          Location
          <select value={locationId} onChange={e=>setLocationId(e.target.value)} className="border rounded p-2">
            <option value="ALL">All</option>
            {locations.map(l => <option key={l.LocationId} value={l.LocationId}>{l.LocationName}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Supplier
          <select value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="border rounded p-2">
            <option value="ALL">All</option>
            {suppliers.map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}
          </select>
        </label>
      </div>

      {/* SKU entry + generate */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="flex flex-col text-sm md:col-span-3">
          SKUs (comma/newline separated)
          <textarea value={skuText} onChange={e=>setSkuText(e.target.value)} rows={3} placeholder="e.g. ABC-123, DEF-456" className="border rounded p-2" />
        </label>
        <div className="flex items-end">
          <button disabled={loading} onClick={loadPlan} className="border rounded px-4 py-2 hover:bg-gray-50">
            {loading ? 'Loading…' : 'Generate plan'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-6">
        {Object.keys(grouped).length === 0 && (
          <div className="text-sm text-gray-500">Enter SKUs and click “Generate plan”.</div>
        )}
        {Object.entries(grouped).map(([key, items]) => {
          const [, supplierName] = key.split('|');
          const total = items.reduce((s:any, r:any)=> s + (r.extended||0), 0);
          return (
            <div key={key} className="border rounded-lg overflow-auto">
              <div className="flex items-center justify-between p-3 bg-gray-50">
                <div className="font-medium">{supplierName}</div>
                <div className="flex items-center gap-3">
                  <div className="text-sm">Total: £{total.toFixed(2)}</div>
                  <button onClick={()=>createPOForGroup(key)} className="border rounded px-3 py-1 hover:bg-white">Create PO</button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3">SKU</th>
                    <th className="text-left p-3">Title</th>
                    <th className="text-right p-3">On Hand</th>
                    <th className="text-right p-3">In OB</th>
                    <th className="text-right p-3">Due</th>
                    <th className="text-right p-3">Avg/day</th>
                    <th className="text-right p-3">Suggested</th>
                    <th className="text-right p-3">Unit £</th>
                    <th className="text-right p-3">Ext £</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r:any)=>(
                    <tr key={r.stockItemId} className="border-t">
                      <td className="p-3">{r.sku}</td>
                      <td className="p-3">{r.title}</td>
                      <td className="p-3 text-right">{r.onHand}</td>
                      <td className="p-3 text-right">{r.inOrderBook}</td>
                      <td className="p-3 text-right">{r.due}</td>
                      <td className="p-3 text-right">{r.avgDaily}</td>
                      <td className="p-3 text-right">{r.suggested}</td>
                      <td className="p-3 text-right">{(r.unitCost||0).toFixed(2)}</td>
                      <td className="p-3 text-right">{(r.extended||0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
