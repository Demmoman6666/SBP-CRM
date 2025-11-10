import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const vendor = searchParams.get("vendor") || "";
  const startStr = searchParams.get("start") || "";
  const endStr = searchParams.get("end") || "";

  const start = startStr ? new Date(startStr) : new Date("1970-01-01");
  const endExclusive = endStr ? addDays(new Date(endStr), 1) : addDays(new Date(), 1);

  // Fetch line items in range, filtered by vendor, then aggregate per order
  const lines = await prisma.orderLine.findMany({
    where: {
      order: { createdAt: { gte: start, lt: endExclusive } },
      ...(vendor && vendor !== "All vendors"
        ? { product: { vendor: { name: vendor } } } // or: product: { vendorName: vendor }
        : {}),
    },
    select: {
      lineTotal: true,
      orderId: true,
      order: {
        select: {
          id: true,
          number: true,
          createdAt: true,
          customer: { select: { name: true } },
          salesRep: true, // change to your field if different
        },
      },
    },
  });

  const byOrder = new Map<string, { id: string; number?: string | null; date: string; customerName: string; salesRep?: string | null; total: number }>();
  for (const li of lines) {
    const o = li.order;
    if (!byOrder.has(o.id)) {
      byOrder.set(o.id, {
        id: o.id,
        number: (o as any).number ?? null,
        date: o.createdAt.toISOString(),
        customerName: o.customer?.name ?? "(no name)",
        salesRep: (o as any).salesRep ?? null,
        total: 0,
      });
    }
    const entry = byOrder.get(o.id)!;
    entry.total += Number(li.lineTotal) || 0;
  }

  const rows = Array.from(byOrder.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  return NextResponse.json({ rows });
}
