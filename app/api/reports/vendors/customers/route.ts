import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// helper: inclusive end-of-day
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const vendor = searchParams.get("vendor") || "";
  const startStr = searchParams.get("start") || "";
  const endStr = searchParams.get("end") || "";

  const start = startStr ? new Date(startStr) : new Date("1970-01-01");
  const endExclusive = endStr ? addDays(new Date(endStr), 1) : addDays(new Date(), 1);

  // ── IMPORTANT: adjust the where block to your schema if names differ ──
  // Assumes: Order -> OrderLine -> Product -> Vendor (by name), and Order -> Customer
  const lines = await prisma.orderLine.findMany({
    where: {
      order: { createdAt: { gte: start, lt: endExclusive } },
      ...(vendor && vendor !== "All vendors"
        ? {
            // EITHER a relation…
            product: { vendor: { name: vendor } },
            // …OR if you store vendor as a string on Product, comment the line above and use:
            // product: { vendorName: vendor },
          }
        : {}),
    },
    select: {
      lineTotal: true,
      orderId: true,
      order: {
        select: {
          customerId: true,
          customer: { select: { id: true, name: true, email: true, city: true } },
        },
      },
    },
  });

  // Reduce to customer-level: orders count (distinct orders), revenue (sum of vendor-filtered lines)
  const map = new Map<
    string,
    { id: string; name: string; email?: string | null; city?: string | null; revenue: number; orders: Set<string> }
  >();

  for (const li of lines) {
    const c = li.order.customer;
    if (!c) continue;
    const key = c.id;
    if (!map.has(key)) {
      map.set(key, {
        id: c.id,
        name: c.name ?? "(no name)",
        email: c.email ?? null,
        city: c.city ?? null,
        revenue: 0,
        orders: new Set<string>(),
      });
    }
    const entry = map.get(key)!;
    entry.revenue += Number(li.lineTotal) || 0;
    entry.orders.add(li.orderId);
  }

  const rows = Array.from(map.values())
    .map((x) => ({ id: x.id, name: x.name, email: x.email, city: x.city, orders: x.orders.size, revenue: x.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({ rows });
}
