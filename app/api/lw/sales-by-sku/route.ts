import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  idBySku?: Record<string, string>; // optional: sku -> stockItemId (from items API)
  locationId?: string;              // optional: for consumption fast-path
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

function isoDaysAgo(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => ({}))) as Input;
  const skus = uniqSkus(payload.skus).slice(0, 200); // safety cap
  if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

  const want30 = payload.days30 !== false;
  const want60 = payload.days60 !== false;
  const locationId = payload.locationId || undefined;
  const providedMap = payload.idBySku || {};

  try {
    const { token, server } = await lwSession();

    // ---------- helpers ----------
    const sumConsumption = (rows: any[], from: Date) => {
      // Look for a qty-like field; count negatives as sales if present,
      // otherwise sum absolute quantity (some tenants provide StockQuantity as already-negative).
      return rows.reduce((acc, r) => {
        const d = new Date(r?.Date ?? r?.date ?? 0);
        if (d < from) return acc;
        const candidates = [
          r?.QuantityChange, r?.ChangeQty, r?.Delta, r?.Change,
          r?.Quantity, r?.Qty, r?.StockQuantity
        ];
        const found = candidates.find((x) => typeof x === "number");
        if (typeof found === "number") {
          const q = found < 0 ? -found : found; // treat negative deltas as sales
          return acc + (Number.isFinite(q) ? q : 0);
        }
        return acc;
      }, 0);
    };

    async function countViaConsumption(sku: string, stockItemId: string | undefined) {
      if (!stockItemId) return { d30: 0, d60: 0, used: false };
      const now = new Date();
      const start60 = new Date(now); start60.setDate(now.getDate() - 60); start60.setHours(0,0,0,0);
      const start30 = new Date(now); start30.setDate(now.getDate() - 30); start30.setHours(0,0,0,0);

      const url = new URL(`${server}/api/Stock/GetStockConsumption`);
      url.searchParams.set("stockItemId", stockItemId);
      url.searchParams.set("startDate", start60.toISOString());
      url.searchParams.set("endDate", now.toISOString());
      if (locationId) url.searchParams.set("locationId", locationId);

      const res = await fetch(url.toString(), { headers: { Authorization: token, Accept: "application/json" } });
      const data: any = await readJson(res);
      const arr: any[] = Array.isArray(data) ? data : [];
      if (!arr.length) return { d30: 0, d60: 0, used: false }; // force fallback

      const d60 = sumConsumption(arr, start60);
      const d30 = sumConsumption(arr, start30);
      // If both are zero, we’ll still try fallback, because some tenants get empty/zeroed consumption.
      return { d30, d60, used: d30 > 0 || d60 > 0 };
    }

    async function countViaProcessedOrders(sku: string, days: number) {
      const { from, to } = isoDaysAgo(days);
      // Paged search variant
      const params = new URLSearchParams({
        from, to,
        dateType: "PROCESSED",
        searchField: "SKU",
        exactMatch: "true",
        searchTerm: sku,
        pageNum: "1",
        numEntriesPerPage: "200",
      });

      let page = 1;
      let total = 0;

      while (true) {
        params.set("pageNum", String(page));
        const resp = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${params}`, {
          method: "POST",
          headers: { Authorization: token, Accept: "application/json" },
          cache: "no-store",
        });
        const data: any = await readJson(resp);
        const rows: any[] = data?.Data || data?.Rows || [];
        for (const r of rows) {
          if (Array.isArray(r?.Items)) {
            for (const it of r.Items) {
              const s = it?.SKU ?? it?.Sku ?? it?.ItemNumber;
              if (s === sku) total += Number(it?.Qty ?? it?.Quantity ?? 0);
            }
          } else {
            total += Number(r?.Qty ?? r?.Quantity ?? 0);
          }
        }
        const perPage = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
        const totalCount = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
        if (!perPage || page * perPage >= totalCount) break;
        page += 1;
        if (page > 40) break; // safety
      }

      // Fallback body search if paged variant is not available
      if (!total) {
        let p = 1;
        while (true) {
          const reqBody = {
            request: {
              DateField: "processed",
              FromDate: from,
              ToDate: to,
              ResultsPerPage: 200,
              PageNumber: p,
              SearchFilters: [{ SearchField: "ItemIdentifier", SearchTerm: sku }],
            },
          };
          const resp = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrders`, {
            method: "POST",
            headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(reqBody),
            cache: "no-store",
          });
          const data: any = await readJson(resp);
          const rows: any[] = data?.Data || data?.Rows || [];
          for (const r of rows) {
            if (Array.isArray(r?.Items)) {
              for (const it of r.Items) {
                const s = it?.SKU ?? it?.Sku ?? it?.ItemNumber;
                if (s === sku) total += Number(it?.Qty ?? it?.Quantity ?? 0);
              }
            } else {
              total += Number(r?.Qty ?? r?.Quantity ?? 0);
            }
          }
          const perPage = Number(data?.ResultsPerPage ?? data?.PageSize ?? 200);
          const totalCount = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
          if (!perPage || p * perPage >= totalCount) break;
          p += 1;
          if (p > 40) break;
        }
      }
      return total;
    }

    // ---------- resolve IDs (if needed) ----------
    const skuToId = new Map<string, string>(Object.entries(providedMap));
    const missing = skus.filter(s => !skuToId.get(s));

    if (missing.length) {
      // Robust resolver (object body forms some tenants require)
      const tryShapes = async (body: any) => {
        const r = await fetch(`${server}/api/Inventory/GetStockItemIdsBySKU`, {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, data: await readJson(r) };
      };

      let ids = await tryShapes({ skus: missing });
      if (!ids.ok || !Array.isArray(ids.data)) {
        const alt = await tryShapes({ Skus: missing });
        if (alt.ok && Array.isArray(alt.data)) ids = alt;
      }
      if (!ids.ok || !Array.isArray(ids.data)) {
        const alt2 = await tryShapes({ SKUs: missing });
        if (alt2.ok && Array.isArray(alt2.data)) ids = alt2;
      }

      if (ids.ok && Array.isArray(ids.data)) {
        for (const row of ids.data) {
          const sku = row?.SKU ?? row?.Sku ?? row?.sku ?? row?.ItemNumber;
          const id  = row?.StockItemId ?? row?.StockItemGuid ?? row?.Id ?? row?.stockItemId;
          if (sku && id) skuToId.set(String(sku), String(id));
        }
      }
    }

    // ---------- compute ----------
    const out: Record<string, { d30?: number; d60?: number }> = {};
    const concurrency = 6;
    let i = 0;

    async function worker() {
      while (i < skus.length) {
        const idx = i++;
        const sku = skus[idx];
        const id = skuToId.get(sku);

        // Try consumption first (fast + supports location)
        let { d30, d60, used } = await countViaConsumption(sku, id);

        // If consumption didn’t give anything, fallback to orders
        if (!used) {
          const sixty = want60 ? await countViaProcessedOrders(sku, 60) : undefined;
          const thirty = want30 ? await countViaProcessedOrders(sku, 30) : undefined;
          d60 = sixty ?? d60 ?? 0;
          d30 = thirty ?? d30 ?? 0;
        }

        out[sku] = { d30: want30 ? (d30 ?? 0) : undefined, d60: want60 ? (d60 ?? 0) : undefined };
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, skus.length) }, worker));

    return NextResponse.json({ ok: true, sales: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
