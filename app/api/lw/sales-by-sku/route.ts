// app/purchase-ordering/page.tsx  (only the changed parts shown)

type Location = { id: string; name: string; tag?: string | null };

// ...

async function fetchPlan(forSupplierId: string) {
  if (!forSupplierId) return;
  setLoading(true);
  setError(null);
  setStatus('Loading items…');
  setItems([]);

  try {
    // 1) items…
    const itsRes = await fetch(`/api/lw/items-by-supplier?supplierId=${encodeURIComponent(forSupplierId)}&limit=800`, { cache: 'no-store' });
    const itsJson = await itsRes.json().catch(() => ({ ok: false }));
    if (!itsJson?.ok) throw new Error(itsJson?.error || 'Failed to fetch items');

    const baseRows: ItemRow[] = (itsJson.items as any[]).map((it: any) => ({
      sku: it.sku,
      title: it.title || '',
      stockItemId: it.stockItemId,
      orderQty: 0,
    }));
    if (!baseRows.length) { setStatus('No items found for this supplier.'); return; }

    setItems(baseRows);
    setStatus(`Loaded ${baseRows.length} item(s). Getting sales…`);

    // 2) sales…
    const idBySku: Record<string, string> = {};
    for (const r of baseRows) if (r.stockItemId) idBySku[r.sku] = r.stockItemId;

    const skus = baseRows.map(r => r.sku).filter(Boolean).slice(0, 400);
    if (skus.length) {
      const locName = locations.find(l => l.id === locationId)?.name || null;
      const salesRes = await fetch('/api/lw/sales-by-sku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus, idBySku, locationName: locName, days30: true, days60: true /* , debug: true */ }),
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
      setStatus(`Sales source: ${salesJson.source || 'n/a'}`);
    }
  } catch (e: any) {
    setError(String(e?.message ?? e));
    setStatus('');
  } finally {
    setLoading(false);
  }
}
