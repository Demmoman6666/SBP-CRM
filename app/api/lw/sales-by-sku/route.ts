import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  days30?: boolean;
  days60?: boolean;
};

function uniqSkus(arr: any): string[] {
  const out = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach(v => { const s = String(v ?? "").trim(); if (s) out.add(s); });
  return [...out];
}

function isoRange(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function readJson(res: Response) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

function normSku(x: unknown) {
  return String(x ?? "").trim().toUpperCase();
}

/** Sum net units for a single SKU from ProcessedOrders (paged). */
async function sumProcessedForSku(server: string, token: string, sku: string, days: number) {
  const { from, to } = isoRange(days);

  async function run(dateType: "SHIPPED" | "PROCESSED") {
    const qp = new URLSearchParams({
      from, to, dateType,
      searchField: "SKU",
      exactMatch: "true",
      searchTerm: sku,
      pageNum: "1",
      numEntriesPerPage: "200",
    });

    let page = 1;
    let total = 0;

    while (true) {
      qp.set("pageNum", String(page));
      const r = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${qp}`, {
        method: "POST",
        headers: { Authorization: token, Accept: "application/json" },
        cache: "no-store",
      });
      const data: any = await readJson(r);
      const rows: any[] = data?.Data || data?.Rows || [];

      for (const ord of rows) {
        const items: any[] = Array.isArray(ord?.Items) ? ord.Items : [];
        for (const it of items) {
          const code = it?.SKU ?? it?.Sku ?? it?.ItemNumber ?? it?.SKUCode;
          if (normSku(code) !== normSku(sku)) continue;

          // Prefer shipped; fall back to qty
          const shipped = Number(it?.QtyShipped ?? it?.QuantityShipped ?? it?.Qty ?? it?.Quantity ?? 0) || 0;
          const returned = Number(it?.QtyReturned ?? it?.ReturnQty ?? 0) || 0;
          const raw = Number(it?.Qty ?? it?.Quantity ?? 0) || 0; // negative lines treated as returns

          total += Math.max(0, shipped || (raw > 0 ? raw : 0)) - (returned + (raw < 0 ? -raw : 0));
        }
      }

      const perPage = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
      const totalResults = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
      if (!perPage || page * perPage >= totalResults) break;
      if (++page > 40) break; // safety
    }

    return total;
  }

  // Prefer shipped window; if no data, fall back to processed
  let total = await run("SHIPPED");
  if (!total) total = await run("PROCESSED");
  return total;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Input;
  const skus = uniqSkus(body.skus).slice(0, 400);
  if (!skus.length) {
    return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });
  }

  const want30 = body.days30 !== false;
  const want60 = body.days60 !== false;

  try {
    const { token, server } = await lwSession();

    const sales: Record<string, { d30?: number; d60?: number }> = {};
    await Promise.all(
      skus.map(async (sku) => {
        const rec: { d30?: number; d60?: number } = {};
        if (want60) rec.d60 = await sumProcessedForSku(server, token, sku, 60);
        if (want30) rec.d30 = await sumProcessedForSku(server, token, sku, 30);
        sales[sku] = rec;
      })
    );

    return NextResponse.json({ ok: true, source: "ProcessedOrders", sales });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

// Force module mode even if TS tree-shakes imports.
export {};
