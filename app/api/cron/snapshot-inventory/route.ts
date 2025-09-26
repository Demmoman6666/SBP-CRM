// app/api/cron/snapshot-inventory/route.ts
import { NextResponse } from "next/server";
import { requireShopifyEnv, shopifyGraphql } from "@/lib/shopify";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Pull "available" quantity per location for every active product variant
const QUERY = /* GraphQL */ `
  query InvSnapshot($cursor: String) {
    products(first: 50, query: "status:active", after: $cursor) {
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
                        location { id name }
                        quantities(names: ["available"]) {
                          name
                          quantity
                        }
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

// Snapshots are keyed by UTC date
function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET(req: Request) {
  try {
    requireShopifyEnv();

    const url = new URL(req.url);
    // Optional: ?when=YYYY-MM-DD to backfill a specific day
    const when = url.searchParams.get("when");
    const date = when ? startOfUtcDay(new Date(when)) : startOfUtcDay(new Date());

    let cursor: string | null = null;
    let variantsSeen = 0;
    let rowsWritten = 0;

    do {
      const data: any = await shopifyGraphql(QUERY, { cursor });
      const prodEdges = data?.products?.edges ?? [];

      for (const pe of prodEdges) {
        const varEdges = pe?.node?.variants?.edges ?? [];
        for (const ve of varEdges) {
          const v = ve?.node;
          const sku = String(v?.sku || "").trim();
          if (!sku) continue;
          variantsSeen++;

          // ⬇️ This is the bit you asked about — place it right here
          const levels = v?.inventoryItem?.inventoryLevels?.edges ?? [];
          for (const le of levels) {
            const loc = le?.node?.location;
            const locId: string = String(loc?.id || "");
            const locName: string | null = loc?.name ?? null;

            const qArr = le?.node?.quantities ?? [];
            const q = Array.isArray(qArr) ? qArr.find((x: any) => x?.name === "available") : null;
            const available = Number(q?.quantity ?? 0);

            // Upsert one row per (date, sku, location)
            await prisma.inventoryDay.upsert({
              where: {
                // uses the @@unique([sku, date, locationId]) constraint from your schema
                sku_date_locationId: { sku, date, locationId: locId },
              },
              create: { date, sku, locationId: locId, locationName: locName, available },
              update: { available, locationName: locName },
            });
            rowsWritten++;
          }
        }
      }

      const pageInfo = data?.products?.pageInfo;
      cursor = pageInfo?.hasNextPage ? pageInfo?.endCursor : null;
    } while (cursor);

    return NextResponse.json({
      ok: true,
      date: date.toISOString().slice(0, 10),
      variantsSeen,
      rowsWritten,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
