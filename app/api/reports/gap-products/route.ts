// app/api/reports/gap-products/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Product = {
  id: number;
  title: string;
  vendor: string;
  variants: Array<{ id: number; title: string | null; sku: string | null }>;
};

async function fetchShopifyProductsByVendor(vendor: string): Promise<Product[]> {
  const out: Product[] = [];
  let pageInfo: string | null = null;

  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({
      vendor,
      limit: "250",
      fields: "id,title,vendor,variants",
      status: "active",
    });
    const url = `/products.json?${qs.toString()}${pageInfo ? `&page_info=${encodeURIComponent(pageInfo)}` : ""}`;

    const r = await shopifyRest(url, { method: "GET" });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Shopify products fetch failed: ${r.status} ${t}`);
    }
    const json = await r.json().catch(() => ({}));
    const products: any[] = json?.products || [];
    for (const p of products) {
      out.push({
        id: Number(p.id),
        title: String(p.title || ""),
        vendor: String(p.vendor || ""),
        variants: (p.variants || []).map((v: any) => ({
          id: Number(v.id),
          title: v.title ?? null,
          sku: v.sku ?? null,
        })),
      });
    }

    const link = r.headers.get("link") || r.headers.get("Link");
    if (!link || !/rel="next"/i.test(link)) break;
    const m = link.match(/<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"/i);
    pageInfo = m?.[1] ?? null;
    if (!pageInfo) break;
  }

  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const vendor: string = String(body?.vendor || "").trim();
    if (!vendor) {
      return NextResponse.json({ error: "Missing vendor (brand)" }, { status: 400 });
    }

    const since = body?.since ? new Date(body.since) : null;
    const until = body?.until ? new Date(body.until) : null;
    const customerIds: string[] = Array.isArray(body?.customerIds) ? body.customerIds.map(String) : [];

    // 1) Full brand catalog so we can show “never purchased”
    const products = await fetchShopifyProductsByVendor(vendor);
    const productIndex = new Map<number, { title: string; sku?: string | null }>();
    for (const p of products) {
      productIndex.set(p.id, { title: p.title, sku: p.variants?.[0]?.sku ?? null });
    }

    // 2) Build order filter (date range + selected customers)
    const whereOrder: any = {};
    if (since) whereOrder.createdAt = { ...(whereOrder.createdAt || {}), gte: since };
    if (until) whereOrder.createdAt = { ...(whereOrder.createdAt || {}), lte: until };
    if (customerIds.length) whereOrder.customerId = { in: customerIds };

    // 3) Query orders and include their lineItems filtered by vendor
    const orders = await prisma.order.findMany({
      where: whereOrder,
      select: {
        id: true,
        customerId: true,
        createdAt: true,
        lineItems: {
          where: { vendor: vendor as any },
          select: {
            productId: true,
            vendor: true,
            quantity: true,
          },
        },
      },
    });

    // Flatten “order + lineItems” into a lineItems array we can use
    const lineItems = orders.flatMap((o) =>
      o.lineItems.map((li) => ({
        orderId: o.id,
        productId: Number(li.productId),
        quantity: Number(li.quantity || 0),
        order: { customerId: o.customerId, createdAt: o.createdAt },
      }))
    );

    // 4) Work out customer set to show
    const customersSet = new Set<string>();
    for (const li of lineItems) if (li.order?.customerId) customersSet.add(li.order.customerId);
    for (const id of customerIds) customersSet.add(id);

    const customers = await prisma.customer.findMany({
      where: { id: { in: Array.from(customersSet) } },
      select: { id: true, salonName: true, customerName: true },
      orderBy: [{ salonName: "asc" }, { customerName: "asc" }],
    });

    // 5) Build bought matrix
    const bought = new Map<string, Set<number>>();
    for (const li of lineItems) {
      const cid = li.order?.customerId;
      const pid = Number(li.productId);
      if (!cid || !productIndex.has(pid)) continue;
      if (!bought.has(cid)) bought.set(cid, new Set());
      bought.get(cid)!.add(pid);
    }

    const productList = Array.from(productIndex.entries()).map(([id, v]) => ({
      id,
      title: v.title,
      sku: v.sku || null,
    }));

    const rows = customers.map((c) => ({
      customerId: c.id,
      customerName: c.salonName || c.customerName || c.id,
      products: productList.map((p) => ({
        productId: p.id,
        bought: bought.get(c.id)?.has(p.id) || false,
      })),
      boughtCount: productList.filter((p) => bought.get(c.id)?.has(p.id)).length,
      gapCount: productList.length - (bought.get(c.id)?.size || 0),
    }));

    return NextResponse.json(
      {
        vendor,
        since: since?.toISOString() || null,
        until: until?.toISOString() || null,
        products: productList,
        customers: rows,
        totals: { productCount: productList.length, customerCount: rows.length },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("gap-products error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
