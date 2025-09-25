// app/api/shopify/sales-by-sku/route.ts
import { NextRequest, NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];
  locationId?: string | null;
  days30?: boolean;
  days60?: boolean;
  mode?: "orders" | "fulfillments";     // default "orders"
  includeCancelled?: boolean;           // default false
};

/** Parse Shopify-style Link header for next page_info */
function nextQueryFromLink(link?: string | null): string | null {
  if (!link) return null;
  const nextPart = link
    .split(",")
    .map(s => s.trim())
    .find(s => /rel="next"/i.test(s));
  if (!nextPart) return null;
  const urlMatch = nextPart.match(/<([^>]+)>/);
  if (!urlMatch) return null;
  try {
    const u = new URL(urlMatch[1]);
    return u.searchParams.toString(); // e.g. "page_info=...&limit=250"
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: Input;
  try {
    body = (await req.json()) as Input;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    days30 = true,
    days60 = true,
    locationId,
    includeCancelled = false,
    mode = "orders", // ← default to ORDERS (paid + unpaid)
  } = body;

  const skus = Array.from(new Set((body.skus || []).map(s => String(s || "").trim()).filter(Boolean)));
  if (!skus.length) {
    return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });
  }

  // Result bucket
  const sales: Record<string, { d30?: number; d60?: number }> = Object.fromEntries(
    skus.map(s => [s, {} as { d30?: number; d60?: number }])
  );
  const now = new Date();

  // Helper to sum a window (x days) using ORDERS (counts line_items.quantity)
  async function sumFromOrders(label: "d30" | "d60", days: number) {
    const start = new Date(now);
    start.setDate(start.getDate() - days);

    // Build initial query
    const qs = new URLSearchParams({
      status: "any", // include open/closed/cancelled; we'll filter cancelled if needed
      processed_at_min: start.toISOString(),
      processed_at_max: now.toISOString(),
      limit: "250",
      fields: "id,processed_at,cancelled_at,location_id,financial_status,line_items",
    });

    // If you *really* want to restrict by POS order location, we can try location_id here.
    // Note: For online orders, location_id is often null; expect zeros if you filter too strictly.
    if (locationId) {
      // Shopify doesn't document location_id as a filter param for orders; we’ll post-filter below.
      // Keeping note here intentionally to avoid 400s from unsupported query params.
    }

    let path: string | null = `/orders.json?${qs.toString()}`;

    while (path) {
      const res = await shopifyRest(path, { method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return NextResponse.json({ ok: false, error: `Shopify orders failed: ${res.status}`, body: text }, { status: res.status });
      }
      const json = await res.json();
      const orders: any[] = Array.isArray(json?.orders) ? json.orders : [];

      for (const ord of orders) {
        // Skip cancelled unless explicitly allowed
        if (!includeCancelled && ord?.cancelled_at) continue;

        // If a specific location is chosen, try to match POS orders by order.location_id
        if (locationId) {
          const oid = ord?.location_id ? String(ord.location_id) : "";
          if (oid !== String(locationId)) continue;
        }

        for (const li of ord?.line_items || []) {
          const sku = String(li?.sku || "").trim();
          const qty = Number(li?.quantity || 0) || 0;
          if (!sku || !(sku in sales)) continue;
          (sales[sku] as any)[label] = ((sales[sku] as any)[label] ?? 0) + qty;
        }
      }

      const link = res.headers.get("Link") || res.headers.get("link");
      const nextQuery = nextQueryFromLink(link);
      path = nextQuery ? `/orders.json?${nextQuery}` : null;
    }
  }

  try {
    if (mode === "orders") {
      const windows: Array<["d30" | "d60", number]> = [];
      if (days30) windows.push(["d30", 30]);
      if (days60) windows.push(["d60", 60]);

      for (const [label, d] of windows) {
        const resp = await sumFromOrders(label, d);
        if (resp) return resp; // early return on HTTP error
      }
      return NextResponse.json({ ok: true, source: "ShopifyOrders", sales });
    }

    // (Optional) Fulfillment mode kept for completeness. If ever needed again, you can add it here.
    return NextResponse.json({ ok: true, source: "ShopifyOrders", sales });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
