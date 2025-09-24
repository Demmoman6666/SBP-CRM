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
  const skus = uniqSkus(payload.skus).slice(0, 200); // safety cap
  if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

  const want30 = payload.days30 !== false;
  const want60 = payload.days60 !== false;
  const locationId = payload.locationId || undefined;

  try {
    const { token, server } = await lwSession();

    // --- 1) Resolve stockItemIds (robust)
    async function tryIds(body: any) {
      const r = await fetch(`${server}/api/Inventory/GetStockItemIdsBySKU`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(r);
      return { ok: r.ok, status: r.status, data };
    }

    // Try object bodies (accounts that reject arrays will accept one of these)
    let idsResp =
      await tryIds({ skus }) ||
      await tryIds({ Skus: skus }) ||
      await tryIds({ SKUs: skus });

    // If the first call returned something falsy (shouldn't), ensure we have an object
    if (!idsResp) idsResp = { ok: false, status: 0, data: null };

    // Normalise any of these shapes to an array of rows
    function rowsFromIds(data: any): any[] | null {
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.Data)) return data.Data;
      if (Array.isArray(data?.items)) return data.items;
      return null;
    }

    let rows = rowsFromIds(idsResp.data);

    // Fallback: if ids couldn’t be read, search each SKU via Stock/GetStockItemsFull
    const skuToId = new Map<string, string>();
    if (rows && idsResp.ok) {
      for (const row of rows) {
        const sku = row?.SKU ?? row?.Sku ?? row?.sku ?? row?.ItemNumber;
        const id  = row?.StockItemId ?? row?.StockItemGuid ?? row?.Id ?? row?.stockItemId;
        if (sku && id) skuToId.set(String(sku), String(id));
      }
    } else {
      // Per-SKU fallback (concurrency limited)
      const concurrency = 6;
      let i = 0;
      async function worker() {
        while (i < skus.length) {
          const idx = i++;
          const sku = skus[idx];
          // Use GetStockItemsFull keyword search with searchTypes ["SKU"]
          const body = {
            keyword: sku,
            searchTypes: ["SKU"],
            entriesPerPage: 50,
            pageNumber: 1,
            dataRequirements: [], // minimal
          };
          try {
            const r = await fetch(`${server}/api/Stock/GetStockItemsFull`, {
              method: "POST",
              headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(body),
            });
            const data: any = await readJson(r);
            const arr: any[] = Array.isArray(data) ? data : [];
            // exact SKU match
            const hit = arr.find((row) => (row?.SKU ?? row?.ItemNumber) === sku);
            const id = hit?.Id ?? hit?.StockItemId ?? hit?.pkStockItemId;
            if (id) skuToId.set(sku, String(id));
          } catch {
            // ignore; leave missing
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, skus.length) }, worker));
    }

    // --- 2) Date windows
    const now = new Date();
    const start60 = new Date(now); start60.setDate(now.getDate() - 60); start60.setHours(0,0,0,0);
    const start30 = new Date(now); start30.setDate(now.getDate() - 30); start30.setHours(0,0,0,0);
    const endISO  = now.toISOString();

    // --- 3) Fetch consumption and aggregate
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
          const q = Number(r?.Quantity ?? r?.Qty ?? r?.StockQuantity ?? 0) || 0;
          return d >= from ? acc + q : acc;
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
