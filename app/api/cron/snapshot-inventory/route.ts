import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireShopifyEnv, shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QUERY = /* GraphQL */ `
  query InvSnapshot($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      edges {
        cursor
        node {
          variants(first: 100) {
            edges {
              node {
                sku
                inventoryItem {
                  inventoryLevels(first: 50) {
                    edges {
                      node {
                        quantities(names: AVAILABLE) { name quantity }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function utcDateOnly(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET() {
  try {
    requireShopifyEnv();

    const today = utcDateOnly();
    let cursor: string | null = null;
    let guard = 0;

    const upserts: Array<Promise<any>> = [];

    do {
      const data: any = await shopifyGraphql(QUERY, { cursor });
      const edges = data?.products?.edges || [];

      for (const e of edges) {
        const vEdges = e?.node?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve?.node;
          const sku = String(v?.sku || "").trim();
          if (!sku) continue;

          const levels = v?.inventoryItem?.inventoryLevels?.edges || [];
          let available = 0;
          for (const le of levels) {
            const qs = le?.node?.quantities || [];
            const qAvail = qs.find((q: any) => q?.name === "AVAILABLE");
            if (qAvail?.quantity != null) available += Number(qAvail.quantity) || 0;
          }

          // locationId is null here (aggregated). If you prefer per-location,
          // request location { id } in the query and upsert per location.
          upserts.push(
            prisma.inventoryDay.upsert({
              where: { sku_locationId_date: { sku, locationId: null, date: today } },
              update: { available },
              create: { sku, locationId: null, date: today, available },
            })
          );
        }
      }

      const hasNext = data?.products?.pageInfo?.hasNextPage;
      cursor = hasNext ? data?.products?.pageInfo?.endCursor : null;
      guard++;
    } while (cursor && guard < 60);

    if (upserts.length) await Promise.allSettled(upserts);

    return NextResponse.json({ ok: true, date: today.toISOString(), rows: upserts.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
