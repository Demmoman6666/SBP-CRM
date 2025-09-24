import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  locationId?: string;      // optional
  days30?: boolean;
  days60?: boolean;
};

// helper: parse -> always array of safe strings
function uniqSkus(arr: any): string[] {
  const s = Array.isArray(arr) ? arr : [];
  const out = new Set<string>();
  for (const v of s) {
    const t = String(v || "").trim();
    if (t) out.add(t);
  }
  return [...out];
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json().catch(() => ({}))) as Input;
    const want30 = payload.days30 !== false; // default true
    const want60 = payload.days60 !== false; // default true
    const locationId = payload.locationId || undefined;

    const inputSkus = uniqSkus(payload.skus).slice(0, 200); // keep well under rate limits
    if (!inputSkus.length) {
      return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });
    }

    const { token, server } = await lwSession();

    // 1) SKUs -> stockItemIds
    const idsRes = await fetch(`${server}/api/Inventory/GetStockItemIdsBySKU`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(inputSkus),
    });
    const idsText = await idsRes.text();
    if (!idsRes.ok) {
      return NextResponse.json({ ok: false, error: `GetStockItemIdsBySKU failed: ${idsRes.status}`, body: idsText }, { status: 502 });
    }
    const idsJson: any = JSON.parse(idsText || "[]");

    // Normalise response -> { sku -> stockItemId }
    const skuToId = new Map<string, string>();
    if (Array.isArray(idsJson)) {
      for (const row of idsJson) {
        const sku = row?.SKU ?? row?.Sku ?? row?.sku ?? row?.ItemNumber ?? row?.itemNumber;
        const id = row?.StockItemId ?? row?.Id ?? row?.stockItemId ?? row?.StockItemGuid;
        if (sku && id) skuToId.set(String(sku), String(id));
      }
    }

    // 2) Build date ranges
    const now = new Date();
    const toIso = (d: Date) => d.toISOString();
    const end60 = toIso(now);
    const start60Date = new Date(now);
    start60Date.setDate(now.getDate() - 60);
    start60Date.setHours(0, 0, 0, 0);
    const start60 = toIso(start60Date);

    const start30Date = new Date(now);
    start30Date.setDate(now.getDate() - 30);
    start30Date.setHours(0, 0, 0, 0);

    // 3) For each item: GetStockConsumption (60d), then derive 30d
    //    GET /api/Stock/GetStockConsumption?stockItemId=&locationId=&startDate=&endDate=
    //    Response: [{ Date, StockQuantity, ... }]
    const sales: Record<string, { d30?: number; d60?: number }> = {};
    for (const sku of inputSkus) {
      const stockItemId = skuToId.get(sku);
      if (!stockItemId) {
        sales[sku] = { d30: 0, d60: 0 };
        continue;
      }

      const url = new URL(`${server}/api/Stock/GetStockConsumption`);
      url.searchParams.set("stockItemId", stockItemId);
      url.searchParams.set("startDate", start60);
      url.searchParams.set("endDate", end60);
      if (locationId) url.searchParams.set("locationId", locationId);

      const cRes = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: token, Accept: "application/json" },
      });
      const cText = await cRes.text();
      if (!cRes.ok) {
        // keep going, but record error for this sku
        sales[sku] = { d30: 0, d60: 0 };
        continue;
      }

      let rows: any[] = [];
      try {
        const j = JSON.parse(cText);
        rows = Array.isArray(j) ? j : [];
      } catch {
        rows = [];
      }

      // sum 60d
      const sum60 = rows.reduce((acc, r) => acc + (Number(r?.StockQuantity ?? 0) || 0), 0);

      // sum last 30d from the same array (Date is ISO)
      const sum30 = rows.reduce((acc, r) => {
        const d = new Date(r?.Date ?? 0);
        return d >= start30Date ? acc + (Number(r?.StockQuantity ?? 0) || 0) : acc;
      }, 0);

      sales[sku] = {
        d60: want60 ? sum60 : undefined,
        d30: want30 ? sum30 : undefined,
      };
    }

    return NextResponse.json({ ok: true, sales });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
