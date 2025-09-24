import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  days30?: boolean;
  days60?: boolean;
  debug?: boolean;
};

function uniqSkus(arr: any): string[] {
  const out = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach(v => { const s = String(v ?? "").trim(); if (s) out.add(s); });
  return [...out];
}
function normSku(x: unknown) { return String(x ?? "").trim().toUpperCase(); }
function rangeISO(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}
async function asJson(res: Response) { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } }

function lineNet(it: any) {
  const shipped = Number(it?.QtyShipped ?? it?.QuantityShipped ?? it?.Qty ?? it?.Quantity ?? 0) || 0;
  const returned = Number(it?.QtyReturned ?? it?.ReturnQty ?? 0) || 0;
  const raw = Number(it?.Qty ?? it?.Quantity ?? 0) || 0; // negative line = return
  return Math.max(0, shipped || (raw > 0 ? raw : 0)) - (returned + (raw < 0 ? -raw : 0));
}

/** Strategy A: ProcessedOrders/SearchProcessedOrdersPaged via query params. */
async function poPaged(server: string, token: string, sku: string, days: number, dateType: "SHIPPED" | "PROCESSED") {
  const { from, to } = rangeISO(days);
  const qp = new URLSearchParams({
    from, to, dateType, searchField: "SKU", exactMatch: "true", searchTerm: sku, pageNum: "1", numEntriesPerPage: "200",
  });

  let page = 1, total = 0;
  while (true) {
    qp.set("pageNum", String(page));
    const resp = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${qp}`, {
      method: "POST", headers: { Authorization: token, Accept: "application/json" }, cache: "no-store",
    });
    const data: any = await asJson(resp);
    const rows: any[] = data?.Data || data?.Rows || [];
    for (const ord of rows) {
      const items: any[] = Array.isArray(ord?.Items) ? ord.Items : [];
      for (const it of items) {
        const code = it?.SKU ?? it?.Sku ?? it?.ItemNumber ?? it?.SKUCode;
        if (normSku(code) !== normSku(sku)) continue;
        total += lineNet(it);
      }
    }
    const per = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
    const count = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
    if (!per || page * per >= count) break;
    if (++page > 40) break;
  }
  return total;
}

/** Strategy B: ProcessedOrders/SearchProcessedOrders (body) with SearchFilters: ItemIdentifier. */
async function poBody(server: string, token: string, sku: string, days: number, dateType: "processed" | "shipped") {
  const { from, to } = rangeISO(days);
  let page = 1, total = 0;
  while (true) {
    const reqBody = {
      request: {
        DateField: dateType, FromDate: from, ToDate: to,
        ResultsPerPage: 200, PageNumber: page,
        SearchFilters: [{ SearchField: "ItemIdentifier", SearchTerm: sku, ExactMatch: true }],
      },
    };
    const resp = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrders`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(reqBody),
      cache: "no-store",
    });
    const data: any = await asJson(resp);
    const rows: any[] = data?.Data || data?.Rows || [];
    for (const ord of rows) {
      const items: any[] = Array.isArray(ord?.Items) ? ord.Items : [];
      for (const it of items) {
        const code = it?.SKU ?? it?.Sku ?? it?.ItemNumber ?? it?.SKUCode;
        if (normSku(code) !== normSku(sku)) continue;
        total += lineNet(it);
      }
    }
    const per = Number(data?.ResultsPerPage ?? data?.PageSize ?? 200);
    const count = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
    if (!per || page * per >= count) break;
    if (++page > 40) break;
  }
  return total;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Input;
  const skus = uniqSkus(body.skus).slice(0, 400);
  if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

  const want30 = body.days30 !== false;
  const want60 = body.days60 !== false;
  const debug = !!body.debug;

  try {
    const { token, server } = await lwSession();

    const sales: Record<string, { d30?: number; d60?: number }> = {};
    const dbg: Record<string, { d30?: string; d60?: string }> = {};

    await Promise.all(
      skus.map(async (sku) => {
        const rec: { d30?: number; d60?: number } = {};
        const trace: { d30?: string; d60?: string } = {};

        // 60d
        if (want60) {
          let v = await poPaged(server, token, sku, 60, "SHIPPED");
          if (v > 0) { rec.d60 = v; trace.d60 = "paged:SHIPPED"; }
          if (!rec.d60) {
            v = await poPaged(server, token, sku, 60, "PROCESSED");
            if (v > 0) { rec.d60 = v; trace.d60 = "paged:PROCESSED"; }
          }
          if (!rec.d60) {
            v = await poBody(server, token, sku, 60, "shipped");
            if (v > 0) { rec.d60 = v; trace.d60 = "body:shipped"; }
          }
          if (!rec.d60) {
            v = await poBody(server, token, sku, 60, "processed");
            rec.d60 = v; trace.d60 = "body:processed";
          }
        }

        // 30d
        if (want30) {
          let v = await poPaged(server, token, sku, 30, "SHIPPED");
          if (v > 0) { rec.d30 = v; trace.d30 = "paged:SHIPPED"; }
          if (!rec.d30) {
            v = await poPaged(server, token, sku, 30, "PROCESSED");
            if (v > 0) { rec.d30 = v; trace.d30 = "paged:PROCESSED"; }
          }
          if (!rec.d30) {
            v = await poBody(server, token, sku, 30, "shipped");
            if (v > 0) { rec.d30 = v; trace.d30 = "body:shipped"; }
          }
          if (!rec.d30) {
            v = await poBody(server, token, sku, 30, "processed");
            rec.d30 = v; trace.d30 = "body:processed";
          }
        }

        sales[sku] = rec;
        if (debug) dbg[sku] = trace;
      })
    );

    return NextResponse.json({ ok: true, source: "ProcessedOrders", sales, ...(debug ? { debug: dbg } : {}) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

// ensure module mode
export {};
