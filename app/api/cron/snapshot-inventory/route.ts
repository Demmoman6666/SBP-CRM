// app/api/cron/snapshot-inventory/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireShopifyEnv, shopifyGraphql, shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keep GraphQL lightweight: just get variant SKUs + inventoryItem.id
const LIST_PRODUCTS = /* GraphQL */ `
  query ListProducts($cursor: String, $query: String) {
    products(first: 12, after: $cursor, query: $query) {
      edges {
        cursor
        node {
          id
          vendor
          variants(first: 50) {
            edges {
              node {
                id
                sku
                inventoryItem { id }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// --- small utils ---
const chunk = <T,>(arr: T[], n: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextPageInfo(linkHeader?: string | null) {
  if (!linkHeader) return null;
  const part = linkHeader.split(",").map(s => s.trim()).find(s => /rel="next"/i.test(s));
  if (!part) return null;
  const m = part.match(/<([^>]+)>/);
  if (!m) return null;
  const url = new URL(m[1]);
  return url.searchParams.get("page_info");
}

export async function GET(req: Request) {
  try {
    requireShopifyEnv();

    const url = new URL(req.url);
    const vendor = url.searchParams.get("vendor") || url.searchParams.get("supplierId") || ""; // optional filter
    const today = startOfUtcDay(new Date());
    const todayISO = today.toISOString().slice(0, 10);

    // 1) Collect variant SKUs + inventoryItemIds (cheap GraphQL pages)
    const query = vendor ? `vendor:"${vendor.replace(/"/g, '\\"')}" status:active` : `status:active`;
    let cursor: string | null = null;
    let productPages = 0;

    // map inventoryItemId -> sku
    const itemIdToSku = new Map<string, string>();

    while (true) {
      const data: any = await shopifyGraphql(LIST_PRODUCTS, { cursor, query });
      productPages++;

      const edges = data?.products?.edges || [];
      for (const e of edges) {
        const vEdges = e?.node?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve?.node;
          const sku = String(v?.sku || "").trim();
          const invIdGid = v?.inventoryItem?.id || "";
          if (!sku || !invIdGid) continue;
          const invNumeric = invIdGid.split("/").pop() || ""; // gid://shopify/InventoryItem/12345 -> 12345
          if (invNumeric) itemIdToSku.set(invNumeric, sku);
        }
      }

      const hasNext = data?.products?.pageInfo?.hasNextPage;
      cursor = hasNext ? data?.products?.pageInfo?.endCursor : null;
      if (!hasNext) break;

      // Safety: avoid ultra-long single runs; this is a daily cron, so page safely
      if (productPages > 500) break;
    }

    if (!itemIdToSku.size) {
      return NextResponse.json({ ok: true, inserted: 0, message: "No variants found for snapshot." });
    }

    // 2) Fetch inventory levels via REST in batches of 50 inventory_item_ids
    const itemIds = Array.from(itemIdToSku.keys());
    const batches = chunk(itemIds, 50);

    type Row = { date: Date; sku: string; locationId: string | null; available: number };

    const rows: Row[] = [];
    for (const ids of batches) {
      // REST: /inventory_levels.json?inventory_item_ids=... (returns all locations)
      let pageInfo: string | null = null;
      let guard = 0;

      do {
        const qs = new URLSearchParams({
          inventory_item_ids: ids.join(","),
          limit: "250",
        });
        if (pageInfo) qs.set("page_info", pageInfo);

        const res = await shopifyRest(`/inventory_levels.json?${qs.toString()}`, { method: "GET" });
        if (!res.ok) throw new Error(`inventory_levels failed: ${res.status} ${await res.text().catch(()=> "")}`);
        const json = await res.json();

        (json?.inventory_levels || []).forEach((lvl: any) => {
          const iid = String(lvl?.inventory_item_id || "");
          const sku = itemIdToSku.get(iid);
          if (!sku) return;
          const locationId = lvl?.location_id ? String(lvl.location_id) : null;
          const available = Number(lvl?.available ?? 0) || 0;
          rows.push({ date: today, sku, locationId, available });
        });

        pageInfo = nextPageInfo(res.headers.get("link"));
        guard++;
      } while (pageInfo && guard < 20);
    }

    // If nothing came back (e.g., items tracked but no levels), still write zeros per SKU at "all locations"
    if (!rows.length) {
      for (const sku of new Set(itemIdToSku.values())) {
        rows.push({ date: today, sku, locationId: null, available: 0 });
      }
    }

    // 3) Persist into InventoryDay (idempotent per unique [date, sku, locationId])
    const data = rows.map(r => ({
      date: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), // force UTC midnight
      sku: r.sku,
      locationId: r.locationId,
      available: r.available,
    }));

    // Optional: clear today's rows for these SKUs to keep freshest snapshot
    await prisma.inventoryDay.deleteMany({
      where: {
        date: today,
        sku: { in: Array.from(new Set(data.map(d => d.sku))) },
      },
    });

    const result = await prisma.inventoryDay.createMany({
      data,
      skipDuplicates: true,
    });

    return NextResponse.json({
      ok: true,
      date: todayISO,
      vendor: vendor || null,
      variantsSeen: itemIdToSku.size,
      rowsWritten: result.count,
      note: "Levels fetched via REST to avoid GraphQL cost limits.",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
