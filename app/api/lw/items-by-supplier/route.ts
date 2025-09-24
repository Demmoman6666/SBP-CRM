import { NextRequest, NextResponse } from 'next/server';
import { lwSession } from '@/lib/linnworks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function readJsonSafely(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function GET(req: NextRequest) {
  const supplierId = req.nextUrl.searchParams.get('supplierId') || '';
  const hardLimit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 800), 2000);
  if (!supplierId) return NextResponse.json({ ok: false, error: 'Missing supplierId' }, { status: 400 });

  try {
    const { token, server } = await lwSession();

    // ---- Fast path: GetStockItemsFull with Supplier data, filter locally
    const entriesPerPage = 200;
    let pageNumber = 1;
    const matched: { id: string; sku: string; title: string }[] = [];

    while (matched.length < hardLimit) {
      const body = {
        keyword: '',
        searchTypes: [],
        showOnlyChanged: false,
        showArchived: false,
        loadCompositeParents: false,
        loadVariationParents: false,
        loadVariationChildren: true,
        entriesPerPage,
        pageNumber,
        dataRequirements: ['Supplier'],
      };

      const res = await fetch(`${server}/api/Stock/GetStockItemsFull`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) break;

      const arr = await readJsonSafely(res);
      const rows: any[] = Array.isArray(arr) ? arr : [];

      for (const r of rows) {
        const suppliers: any[] = Array.isArray(r?.Suppliers) ? r.Suppliers : [];
        const isMatch = suppliers.some((s) => {
          const sid = s?.SupplierID ?? s?.SupplierId ?? s?.fkSupplierId ?? s?.pkSupplierId ?? s?.Id;
          return sid && String(sid).toLowerCase() === supplierId.toLowerCase();
        });
        if (isMatch) {
          matched.push({
            id: String(r?.Id ?? r?.StockItemId ?? r?.pkStockItemId ?? ''),
            sku: String(r?.SKU ?? r?.ItemNumber ?? r?.ItemSku ?? r?.StockLevels?.[0]?.SKU ?? ''),
            title: String(r?.ItemTitle ?? r?.Title ?? r?.ItemName ?? ''),
          });
          if (matched.length >= hardLimit) break;
        }
      }

      if (rows.length < entriesPerPage) break;
      pageNumber++;
      if (pageNumber > 100) break;
    }

    if (matched.length) {
      const items = matched
        .filter(x => x.sku && x.id)
        .map(x => ({ sku: x.sku, title: x.title || '', stockItemId: x.id }))
        .slice(0, hardLimit);
      return NextResponse.json({ ok: true, items });
    }

    // ---- Fallback: find by supplier stats, then hydrate by ids
    // 1) gather all IDs
    const allIds: string[] = [];
    pageNumber = 1;
    while (true) {
      const body = {
        keyword: '',
        searchTypes: [],
        showOnlyChanged: false,
        showArchived: false,
        loadCompositeParents: false,
        loadVariationParents: false,
        loadVariationChildren: true,
        entriesPerPage,
        pageNumber,
        dataRequirements: [],
      };
      const res = await fetch(`${server}/api/Stock/GetStockItemsFull`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) break;
      const arr = await readJsonSafely(res);
      const rows: any[] = Array.isArray(arr) ? arr : [];
      for (const r of rows) {
        const id = r?.Id ?? r?.StockItemId;
        if (id) allIds.push(String(id));
      }
      if (rows.length < entriesPerPage) break;
      pageNumber++;
      if (pageNumber > 200) break;
    }

    // 2) supplier stats bulk → filter ids
    const byId: Record<string, true> = {};
    const chunk = <T,>(a: T[], n: number) => {
      const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o;
    };
    for (const ids of chunk(allIds, 200)) {
      const qs = ids.map(id => `inventoryItemIds=${encodeURIComponent(id)}`).join('&');
      const res = await fetch(`${server}/api/Inventory/GetStockSupplierStatsBulk?${qs}`, {
        headers: { Authorization: token, Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const stats = await readJsonSafely(res);
      const arr = Array.isArray(stats) ? stats : [];
      for (const s of arr) {
        const sid = s?.SupplierID ?? s?.SupplierId ?? s?.fkSupplierId ?? s?.Id;
        if (sid && String(sid).toLowerCase() === supplierId.toLowerCase()) {
          const stockId = String(s?.StockItemId ?? s?.StockItemID ?? '');
          if (stockId) byId[stockId] = true;
        }
      }
      if (Object.keys(byId).length >= hardLimit) break;
    }

    const wantedIds = Object.keys(byId).slice(0, hardLimit);
    if (!wantedIds.length) return NextResponse.json({ ok: true, items: [] });

    // 3) hydrate by ids (sku/title)
    const out: { sku: string; title: string; stockItemId: string }[] = [];
    for (const ids of chunk(wantedIds, 200)) {
      const res = await fetch(`${server}/api/Stock/GetStockItemsFullByIds`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ stockItemIds: ids, dataRequirements: [] }),
      });
      if (!res.ok) continue;
      const arr = await readJsonSafely(res);
      const rows: any[] = Array.isArray(arr) ? arr : [];
      for (const r of rows) {
        const sku = r?.SKU ?? r?.SKUCode ?? '';
        const title = r?.Title ?? r?.ItemTitle ?? '';
        const id = String(r?.Id ?? r?.StockItemId ?? r?.pkStockItemId ?? '');
        if (sku && id) out.push({ sku, title, stockItemId: id });
      }
    }

    return NextResponse.json({ ok: true, items: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'items-by-supplier error' }, { status: 500 });
  }
}
