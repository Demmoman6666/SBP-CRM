import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  locationId?: string;
  days30?: boolean;
  days60?: boolean;
};

function uniqSkus(arr: any): string[] {
  const set = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach((s) => {
    const v = String(s ?? "").trim();
    if (v) set.add(v);
  });
  return [...set];
}

async function readJson(res: Response) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Input;
    const skus = uniqSkus(body.skus).slice(0, 200); // safety cap
    if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

    const want30 = body.days30 !== false;
    const want60 = body.days60 !== false;
    const locationId = body.locationId || undefined;

    const { token, server } = await lwSession();

    // --- 1) SKUs -> stockItemIds (try array body, then { skus } body)
    async function getIds(payload: any) {
      const res = await fetch(`${server}/api/Inventory/GetStockItemIdsBySKU`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: res.ok, data: await readJson(res), status: res.status };
    }

    let ids = await getIds(skus);
    if (!ids.ok || !Array.isArray(ids.data)) {
      // retry alternative shape
      const retry = await getIds({ skus });
      if (retry.ok && Array.isArray(retry.data)) ids = retry;
    }
    if (!Array.isArray(ids.data)) {
      return NextResponse.json({ ok: false, error: "GetStockItemIdsBySKU failed", status: ids.status, body: ids.data }, { status: 502 });
    }

    const skuToId = new Map<string, string>();
    for (const row of ids.data) {
      const sku = row?.SKU ?? row?.Sku ?? row?.sku ?? row?.ItemNumber;
      const id  = row?.StockItemId ?? row?.StockItemGuid ?? row?.Id ?? row?.stockItemId;
      if (sku && id) skuToId.set(String(sku), String(id));
    }

    // --- 2) Date windows
    const now = new Date();
    const start60 = new Date(now); start60.setDate(now.getDate() - 60); start60.setHours(0,0,0,0);
    const start30 = new Date(now); start30.setDate(now.getDate() - 30); start30.setHours(0,0,0,0);
    const endISO  = now.toISOString();

    // --- 3) For each sku: Stock/GetStockConsumption (60d), derive 30d
    const sales: Record<string, { d30?: number; d60?: number }> = {};
    for (const sku of skus) {
      const stockItemId = skuToId.get(sku);
      if (!stockItemId) { sales[sku] = { d30: 0, d60: 0 }; continue; }

      const url = new URL(`${server}/api/Stock/GetStockConsumption`);
      url.searchParams.set("stockItemId", stockItemId);
      url.searchParams.set("startDate", start60.toISOString());
      url.searchParams.set("endDate", endISO);
      if (locationId) url.searchParams.set("locationId", locationId);

      const res = await fetch(url.toString(), { headers: { Authorization: token, Accept: "application/json" } });
      const data: any = await readJson(res);
      const rows: any[] = Array.isArray(data) ? data : [];

      // field names vary; prefer explicit "Quantity"/"Qty"/"StockQuantity"
      const sum = (from: Date) =>
        rows.reduce((acc, r) => {
          const d = new Date(r?.Date ?? r?.date ?? 0);
          const q = Number(r?.Quantity ?? r?.Qty ?? r?.StockQuantity ?? 0) || 0;
          return d >= from ? acc + q : acc;
        }, 0);

      sales[sku] = {
        d60: want60 ? sum(start60) : undefined,
        d30: want30 ? sum(start30) : undefined,
      };
    }

    return NextResponse.json({ ok: true, sales });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
