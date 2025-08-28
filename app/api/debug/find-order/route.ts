// app/api/debug/find-order/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/find-order?number=12345
 *     /api/debug/find-order?name=#1001
 *     /api/debug/find-order?id=gid://shopify/Order/...
 *
 * Returns the matching order (if any), including its customer link.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const number = url.searchParams.get("number")?.trim() || "";
  const name = url.searchParams.get("name")?.trim() || "";
  const id = url.searchParams.get("id")?.trim() || "";

  if (!number && !name && !id) {
    return NextResponse.json(
      { error: "Provide ?number=, ?name= or ?id=" },
      { status: 400 }
    );
  }

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        number ? { shopifyOrderNumber: number } : undefined,
        name ? { shopifyName: name } : undefined,
        id ? { shopifyId: id } : undefined,
      ].filter(Boolean) as any,
    },
    include: {
      customer: { select: { id: true, salonName: true, customerEmailAddress: true } },
    },
    take: 5,
  });

  return NextResponse.json({ found: orders.length, orders });
}
