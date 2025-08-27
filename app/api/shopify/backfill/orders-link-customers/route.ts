// app/api/shopify/backfill/orders-link-customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest, upsertCustomerFromShopify } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shopify/backfill/orders-link-customers?limit=50&rpm=120
 * Finds orders with missing customer links, fetches each order from Shopify,
 * extracts order.customer.id (+ customer object), and links the order.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const rpm   = Math.max(30, Math.min(240, Number(url.searchParams.get("rpm")) || 120));
  const delay = Math.round(60000 / rpm);

  // Find candidate orders: missing shopifyCustomerId OR missing CRM customerId
  const candidates = await prisma.order.findMany({
    where: {
      OR: [
        { shopifyCustomerId: null },
        { customerId: null },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, shopifyOrderId: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, remaining: 0, message: "No candidates." });
  }

  let processed = 0;
  let linked    = 0;
  let skipped   = 0;

  for (const o of candidates) {
    processed++;
    try {
      const res = await shopifyRest(`/orders/${o.shopifyOrderId}.json?status=any`, { method: "GET" });
      if (!res.ok) {
        skipped++;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const json = await res.json();
      const sOrder = json?.order;
      const sCust  = sOrder?.customer;

      const sCustId = sCust?.id ? String(sCust.id) : null;
      if (!sCustId) {
        // guest checkout or missing customer; nothing to link
        skipped++;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Ensure a CRM customer exists/updated for this Shopify customer
      await upsertCustomerFromShopify(sCust, ""); // shop domain unused in your impl

      // Find the CRM customer
      const crmCust = await prisma.customer.findFirst({
        where: { shopifyCustomerId: sCustId },
        select: { id: true },
      });

      // Update the order with shopifyCustomerId and (if we have it) customerId
      await prisma.order.update({
        where: { id: o.id },
        data: {
          shopifyCustomerId: sCustId,
          customerId: crmCust ? crmCust.id : null,
        },
      });

      if (crmCust) linked++;
    } catch {
      skipped++;
    }

    await new Promise(r => setTimeout(r, delay));
  }

  // How many still left overall?
  const remaining = await prisma.order.count({
    where: {
      OR: [
        { shopifyCustomerId: null },
        { customerId: null },
      ],
    },
  });

  return NextResponse.json({ ok: true, processed, linked, skipped, remaining, rpm });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST this endpoint to backfill missing order→customer links." });
}
