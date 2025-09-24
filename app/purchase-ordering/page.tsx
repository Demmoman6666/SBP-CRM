import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  idBySku?: Record<string, string>; // optional: sku -> stockItemId
  locationId?: string;
  days30?: boolean;
  days60?: boolean;
};

function uniqSkus(arr: any): string[] {
  const out = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s = String(v ?? "").trim();
    if (s) out.add(s);
  });
  return [...out];
}

async function readJson(res: Response) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
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

    // Resolve IDs only for SKUs not provided by the client
    const missing = skus.filter(s => !providedMap[s]);
    const skuToId = new Map<string, string>(Object.entries(providedMap));

    if (missing.length) {
      // Try the object body shapes that some accounts require
      const tryShapes = async (body: any) => {
        const r = await fetch(`${server}/api/Inventory/GetStockItemIdsBySKU`, {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, status: r.status, data: await readJson(r) };
      };

      let idsResp = await tryShapes({ skus: missing });
      if (!idsResp.ok || !Array.isArray(idsResp.data)) {
        const alt = await tryShapes({ Skus: missing });
        if (alt.ok && Array.isArray(alt.data)) idsResp = alt;
      }
      if (!idsResp.ok || !Array.isArray(idsResp.data)) {
        const alt2 = await tryShapes({ SKUs: missing });
        if (alt2.ok && Array.isArray(alt2.data)) idsResp = alt2;
      }

      if (idsResp.ok && Array.isArray(idsResp.data)) {
        for (const row of idsResp.data) {
          const sku = row?.SKU ?? row?.Sku ?? row?.sku ?? row?.ItemNumber;
          const id  = row?.StockItemId ?? row?.StockItemGuid ?? row?.Id ?? row?.stockItemId;
          if (sku && id) skuToId.set(String(sku), String(id));
        }
      } else {
        // Fallback per-SKU search via Stock/GetStockItemsFull
        for (const sku of missing) {
          const body = { keyword: sku, searchTypes: ["SKU"], entriesPerPage: 50, pageNumber: 1, dataRequirements: [] };
          try {
            const r = await fetch(`${server}/api/Stock/GetStockItemsFull`, {
              method: "POST",
              headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(body),
            });
            const data: any = await readJson(r);
            const arr: any[] = Array.isArray(data) ? data : [];
            const hit = arr.find((row) => (row?.SKU ?? row?.ItemNumber) === sku);
            const id = hit?.Id ?? hit?.StockItemId ?? hit?.pkStockItemId;
            if (id) skuToId.set(sku, String(id));
          } catch {/* ignore */}
        }
      }
    }

    // Date windows
    const now = new Date();
    const start60 = new Date(now); start60.setDate(now.getDate() - 60); start60.setHours(0,0,0,0);
    const start30 = new Date(now); start30.setDate(now.getDate() - 30); start30.setHours(0,0,0,0);
    const endISO  = now.toISOString();

    // Fetch consumption & aggregate (treat negatives as sales)
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
      const arr: any[] = Array.isArray(data) ? data : [];

      const sumFrom = (from: Date) =>
        arr.reduce((acc, r) => {
          const d = new Date(r?.Date ?? r?.date ?? 0);
          const qRaw = Number(r?.Quantity ?? r?.Qty ?? r?.StockQuantity ?? 0) || 0;
          // If consumption uses negative deltas for stock-out, count the magnitude of negatives as sales:
          const qSold = qRaw < 0 ? -qRaw : qRaw;
          return d >= from ? acc + qSold : acc;
        }, 0);

      sales[sku] = {
        d60: want60 ? sumFrom(start60) : undefined,
        d30: want30 ? sumFrom(start30) : undefined,
      };
    }

    return NextResponse.json({ ok: true, sales });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
