import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];                 // list from UI (supplier's items)
  locationName?: string | null;   // human name from the Locations dropdown (e.g., "Warehouse")
  days30?: boolean;
  days60?: boolean;
};

function uniqSkus(arr: any): string[] {
  const out = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach(v => { const s = String(v ?? "").trim(); if (s) out.add(s); });
  return [...out];
}
function agoISO(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function readJson(res: Response) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

// --- Query Data (Dashboards/ExecuteCustomPagedScript) helper
async function runQueryData(server: string, token: string, scriptId: number, pars: any[]) {
  const body = `scriptId=${scriptId}` +
               `&parameters=${encodeURIComponent(JSON.stringify(pars))}` +
               `&entriesPerPage=1000&pageNumber=1`;
  const r = await fetch(`${server}/api/Dashboards/ExecuteCustomPagedScript`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
  });
  const data: any = await readJson(r);
  return (Array.isArray(data?.Data) ? data.Data : Array.isArray(data?.Rows) ? data.Rows : []) as any[];
}

// Best-effort parser: different scripts expose slightly different column names.
function sumFromQD(rows: any[], sku: string) {
  let sum = 0;
  for (const r of rows) {
    const s = r?.SKU ?? r?.Sku ?? r?.ItemNumber ?? r?.StockItemSKU ?? r?.ChannelSKU;
    if (String(s) !== sku) continue;
    const q = Number(
      r?.Qty ?? r?.Quantity ?? r?.UnitsSold ?? r?.DespatchedQty ?? r?.SoldQty ?? r?.QtyProcessed ?? 0
    ) || 0;
    sum += q;
  }
  return sum;
}

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => ({}))) as Input;
  const skus = uniqSkus(payload.skus).slice(0, 400);
  if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

  const want30 = payload.days30 !== false;
  const want60 = payload.days60 !== false;
  const { token, server } = await lwSession();

  const out: Record<string, { d30?: number; d60?: number }> = {};
  for (const s of skus) out[s] = { d30: want30 ? 0 : undefined, d60: want60 ? 0 : undefined };

  // --- 1) Try Query Data (prefer location-aware script 53; else 47)
  try {
    const tryScripts = async (fromISO: string, toISO: string) => {
      const attempts: { scriptId: number; params: any[] }[] = [];

      // Common date parameter sets across QD scripts
      const dateSets = [
        [{ Type: "DateTime", Name: "fromDate", Value: fromISO }, { Type: "DateTime", Name: "toDate", Value: toISO }],
        [{ Type: "DateTime", Name: "startDate", Value: fromISO }, { Type: "DateTime", Name: "endDate", Value: toISO }],
        [{ Type: "DateTime", Name: "dateFrom", Value: fromISO }, { Type: "DateTime", Name: "dateTo", Value: toISO }],
      ];
      // Location parameter name varies
      const locParam = payload.locationName
        ? [{ Type: "Select", Name: "locationName", Value: payload.locationName },
           { Type: "Select", Name: "Location",     Value: payload.locationName },
           { Type: "Select", Name: "StockLocation",Value: payload.locationName }]
        : [];

      // script 53 (by Location & Source)
      for (const ds of dateSets) {
        if (payload.locationName) {
          for (const lp of locParam) attempts.push({ scriptId: 53, params: [...ds, lp] });
        } else {
          attempts.push({ scriptId: 53, params: ds });
        }
      }
      // script 47 (Sold Granular)
      for (const ds of dateSets) attempts.push({ scriptId: 47, params: ds });

      for (const a of attempts) {
        const rows = await runQueryData(server, token, a.scriptId, a.params);
        if (rows.length) return rows;
      }
      return [] as any[];
    };

    // 60-day block (we’ll derive 30 separately too)
    const { from: f60, to: t60 } = agoISO(60);
    const rows60 = want60 ? await tryScripts(f60, t60) : [];
    // 30-day block
    const { from: f30, to: t30 } = agoISO(30);
    const rows30 = want30 ? await tryScripts(f30, t30) : [];

    if ((rows60?.length || rows30?.length)) {
      for (const sku of skus) {
        if (want60) out[sku].d60 = sumFromQD(rows60, sku);
        if (want30) out[sku].d30 = sumFromQD(rows30, sku);
      }
      return NextResponse.json({ ok: true, source: "QueryData", sales: out });
    }
  } catch (e) {
    // swallow and fall back
  }

  // --- 2) Fallback to ProcessedOrders (if QD unavailable)
  try {
    const fetchPaged = async (sku: string, days: number) => {
      const { from, to } = agoISO(days);
      const params = new URLSearchParams({
        from, to, dateType: "SHIPPED", searchField: "SKU", exactMatch: "true", searchTerm: sku, pageNum: "1", numEntriesPerPage: "200",
      });
      let page = 1, total = 0;
      while (true) {
        params.set("pageNum", String(page));
        const r = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${params}`, {
          method: "POST", headers: { Authorization: token, Accept: "application/json" }, cache: "no-store",
        });
        const data: any = await readJson(r);
        const rows: any[] = data?.Data || data?.Rows || [];
        for (const ord of rows) {
          const items: any[] = Array.isArray(ord?.Items) ? ord.Items : [];
          for (const it of items) {
            const code = it?.SKU ?? it?.Sku ?? it?.ItemNumber;
            if (String(code) !== sku) continue;
            const shipped = Number(it?.QtyShipped ?? it?.QuantityShipped ?? it?.Qty ?? it?.Quantity ?? 0) || 0;
            const returned = Number(it?.QtyReturned ?? it?.ReturnQty ?? 0) || 0;
            const raw = Number(it?.Qty ?? it?.Quantity ?? 0) || 0;
            total += Math.max(0, shipped || (raw > 0 ? raw : 0)) - (returned + (raw < 0 ? -raw : 0));
          }
        }
        const per = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
        const count = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
        if (!per || page * per >= count) break;
        if (++page > 40) break;
      }
      return total;
    };

    await Promise.all(skus.map(async (sku) => {
      if (want60) out[sku].d60 = await fetchPaged(sku, 60);
      if (want30) out[sku].d30 = await fetchPaged(sku, 30);
    }));

    return NextResponse.json({ ok: true, source: "ProcessedOrders", sales: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
