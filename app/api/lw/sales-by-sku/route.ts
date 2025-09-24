import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  idBySku?: Record<string, string>;
  locationId?: string;
  days30?: boolean;
  days60?: boolean;
};

function uniqSkus(arr: any): string[] {
  const out = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach(v => { const s = String(v ?? "").trim(); if (s) out.add(s); });
  return [...out];
}
async function readJson(res: Response) { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } }
function isoDaysAgo(days: number) { const to = new Date(); const from = new Date(to.getTime() - days*86400000); return { from: from.toISOString(), to: to.toISOString() }; }
const isCancelStatus = (s?: string) => !!s && /cancel|void|deleted|refunded/i.test(s);

/** SAFER consumption parser: only count rows that look like sales/shipments. */
function sumConsumptionAsSales(rows: any[], from: Date) {
  return rows.reduce((acc, r) => {
    const d = new Date(r?.Date ?? r?.date ?? 0);
    if (d < from) return acc;

    const reason = r?.Reason ?? r?.ChangeType ?? r?.ReferenceType ?? "";
    // Only count likely outbound reasons; otherwise ignore consumption (transfers/adjustments inflate numbers)
    const looksLikeSale = /sale|order|dispatch|ship|outbound/i.test(String(reason));
    if (!looksLikeSale) return acc;

    // Many tenants give negative for stock-out. Take magnitude of negative; if positive, accept as-is.
    const q = Number(r?.QuantityChange ?? r?.ChangeQty ?? r?.Quantity ?? r?.Qty ?? r?.StockQuantity ?? 0) || 0;
    const sold = q < 0 ? -q : q;
    return acc + sold;
  }, 0);
}

/** Robust line parser: shipped minus returns; skip services/cancelled. */
function addFromOrderLines(rows: any[], sku: string) {
  let shipped = 0, returned = 0;

  for (const r of rows) {
    const status =
      r?.GeneralInfo?.Status ?? r?.Status ?? r?.OrderStatus ?? r?.GeneralInfo?.OrderStatusText ?? "";
    if (isCancelStatus(status)) continue;

    const items: any[] = Array.isArray(r?.Items) ? r.Items : (Array.isArray(r?.items) ? r.items : []);
    for (const it of items) {
      const s = it?.SKU ?? it?.Sku ?? it?.ItemNumber ?? it?.SKUCode;
      if (String(s) !== sku) continue;

      if (it?.IsService) continue;

      const qtyShipped = Number(it?.QtyShipped ?? it?.QuantityShipped ?? it?.Qty ?? it?.Quantity ?? 0) || 0;
      const qtyReturned = Number(it?.QtyReturned ?? it?.ReturnQty ?? 0) || 0;
      // Some accounts record returns as negative qty lines
      const rawQty = Number(it?.Qty ?? it?.Quantity ?? 0) || 0;
      const negAsReturn = rawQty < 0 ? -rawQty : 0;

      shipped += Math.max(0, qtyShipped || (rawQty > 0 ? rawQty : 0));
      returned += qtyReturned + negAsReturn;
    }
  }
  return shipped - returned;
}

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => ({}))) as Input;
  const skus = uniqSkus(payload.skus).slice(0, 200);
  if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

  const want30 = payload.days30 !== false;
  const want60 = payload.days60 !== false;
  const locationId = payload.locationId || undefined;
  const providedMap = payload.idBySku || {};

  try {
    const { token, server } = await lwSession();

    // Resolve IDs only if missing in idBySku
    const skuToId = new Map<string, string>(Object.entries(providedMap));
    const missing = skus.filter(s => !skuToId.get(s));
    if (missing.length) {
      // object bodies some accounts require
      const tryShapes = async (body: any) => {
        const r = await fetch(`${server}/api/Inventory/GetStockItemIdsBySKU`, {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, data: await readJson(r) };
      };
      let ids = await tryShapes({ skus: missing });
      if (!ids.ok || !Array.isArray(ids.data)) ids = await tryShapes({ Skus: missing });
      if (!ids.ok || !Array.isArray(ids.data)) ids = await tryShapes({ SKUs: missing });

      if (ids.ok && Array.isArray(ids.data)) {
        for (const row of ids.data) {
          const sku = row?.SKU ?? row?.Sku ?? row?.sku ?? row?.ItemNumber;
          const id  = row?.StockItemId ?? row?.StockItemGuid ?? row?.Id ?? row?.stockItemId;
          if (sku && id) skuToId.set(String(sku), String(id));
        }
      }
    }

    const now = new Date();
    const start60 = new Date(now); start60.setDate(now.getDate() - 60); start60.setHours(0,0,0,0);
    const start30 = new Date(now); start30.setDate(now.getDate() - 30); start30.setHours(0,0,0,0);

    // helpers: processed orders fetchers (two variants)
    async function fetchProcessedPaged(sku: string, dateType: "SHIPPED" | "PROCESSED", days: number) {
      const { from, to } = isoDaysAgo(days);
      const params = new URLSearchParams({
        from, to,
        dateType,
        searchField: "SKU",
        exactMatch: "true",
        searchTerm: sku,
        pageNum: "1",
        numEntriesPerPage: "200",
      });
      let page = 1, all: any[] = [];
      while (true) {
        params.set("pageNum", String(page));
        const resp = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${params}`, {
          method: "POST",
          headers: { Authorization: token, Accept: "application/json" },
          cache: "no-store",
        });
        const data: any = await readJson(resp);
        const rows: any[] = data?.Data || data?.Rows || [];
        all = all.concat(rows);
        const perPage = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
        const totalCount = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
        if (!perPage || page * perPage >= totalCount) break;
        if (++page > 40) break;
      }
      return all;
    }

    async function ordersNetQty(sku: string, days: number) {
      // shipped window preferred
      let rows = await fetchProcessedPaged(sku, "SHIPPED", days);
      if (!rows.length) rows = await fetchProcessedPaged(sku, "PROCESSED", days);
      return addFromOrderLines(rows, sku);
    }

    const out: Record<string, { d30?: number; d60?: number }> = {};
    for (const sku of skus) {
      const id = skuToId.get(sku);
      let d30 = 0, d60 = 0;
      let consumptionUsed = false;

      // Try consumption strictly (only stock-out reasons)
      if (id) {
        const url = new URL(`${server}/api/Stock/GetStockConsumption`);
        url.searchParams.set("stockItemId", id);
        url.searchParams.set("startDate", start60.toISOString());
        url.searchParams.set("endDate", now.toISOString());
        if (locationId) url.searchParams.set("locationId", locationId);

        try {
          const res = await fetch(url.toString(), { headers: { Authorization: token, Accept: "application/json" } });
          const data: any = await readJson(res);
          const arr: any[] = Array.isArray(data) ? data : [];
          const s60 = sumConsumptionAsSales(arr, start60);
          const s30 = sumConsumptionAsSales(arr, start30);
          if (s30 > 0 || s60 > 0) {
            d30 = s30; d60 = s60; consumptionUsed = true;
          }
        } catch { /* ignore and fallback */ }
      }

      // Fallback or supplement with processed orders (net shipped - returns)
      if (!consumptionUsed) {
        d60 = want60 ? await ordersNetQty(sku, 60) : 0;
        d30 = want30 ? await ordersNetQty(sku, 30) : 0;
      }

      out[sku] = { d30: want30 ? d30 : undefined, d60: want60 ? d60 : undefined };
    }

    return NextResponse.json({ ok: true, sales: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
