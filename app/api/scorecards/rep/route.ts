// app/api/scorecards/rep/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TargetScope, TargetMetric } from "@prisma/client";

export const dynamic = "force-dynamic";

// Parse YYYY-MM or full ISO, return start-of-month if YYYY-MM
function parseStart(v: string | null): Date | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}$/.test(v)) return new Date(`${v}-01T00:00:00Z`);
  const d = new Date(v);
  return isNaN(+d) ? null : d;
}
function endOfMonth(d: Date) {
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return e;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repId = searchParams.get("repId");
  const start = parseStart(searchParams.get("start") || searchParams.get("month"));
  let end = searchParams.get("end") ? new Date(String(searchParams.get("end"))) : null;
  if (start && !end) end = endOfMonth(start);

  if (!repId || !start || !end || isNaN(+end)) {
    return NextResponse.json({ error: "repId, start/month, and end are required" }, { status: 400 });
  }

  // get rep name for customer matching
  const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
  if (!rep) return NextResponse.json({ error: "Rep not found" }, { status: 404 });

  // current window [start, end]
  const curStart = start;
  const curEnd = end;

  // previous window with same length
  const days = Math.ceil((+curEnd - +curStart) / 86400000) + 1;
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -(days - 1));

  // Fetch orders (current & prev), include line items for vendor breakdown
  const [curOrders, prevOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        processedAt: { gte: curStart, lte: curEnd },
        customer: { salesRep: rep.name }, // match your Customer.salesRep string
      },
      select: {
        id: true,
        total: true,
        processedAt: true,
        currency: true,
        lineItems: { select: { productVendor: true, total: true } },
        customerId: true,
      },
    }),
    prisma.order.findMany({
      where: {
        processedAt: { gte: prevStart, lte: prevEnd },
        customer: { salesRep: rep.name },
      },
      select: { id: true, total: true, processedAt: true, currency: true },
    }),
  ]);

  // revenue totals
  const sum = (arr: any[]) =>
    arr.reduce((a, o) => a + (o.total ? Number(o.total) : 0), 0);
  const revenue = sum(curOrders);
  const revenuePrev = sum(prevOrders);
  const currency = curOrders[0]?.currency || "GBP";

  // orders count
  const orders = curOrders.length;
  const ordersPrev = prevOrders.length;

  // new customers: those with first-ever order in current window
  const customerIds = Array.from(new Set(curOrders.map((o) => o.customerId).filter(Boolean))) as string[];
  let newCustomers = 0;
  if (customerIds.length) {
    const earliest = await prisma.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, customer: { salesRep: rep.name } },
      _min: { processedAt: true },
    });
    newCustomers = earliest.filter((g) => {
      const first = g._min.processedAt;
      return first && first >= curStart && first <= curEnd;
    }).length;
  }

  // vendor breakdown for current window
  const vendorMap: Record<string, number> = {};
  for (const o of curOrders) {
    for (const li of o.lineItems) {
      const v = (li.productVendor || "").trim();
      if (!v) continue;
      vendorMap[v] = (vendorMap[v] || 0) + (li.total ? Number(li.total) : 0);
    }
  }
  const vendors = Object.entries(vendorMap)
    .sort((a, b) => b[1] - a[1])
    .map(([vendor, total]) => ({ vendor, revenue: total }));

  // pull targets for this rep & period
  const targets = await prisma.target.findMany({
    where: {
      scope: "REP",
      repId,
      periodStart: curStart,
      periodEnd: curEnd,
    },
  });

  const targetRevenue = Number(targets.find((t) => t.metric === "REVENUE")?.amount || 0);
  const targetOrders = Number(targets.find((t) => t.metric === "ORDERS")?.amount || 0);
  const targetNewCustomers = Number(targets.find((t) => t.metric === "NEW_CUSTOMERS")?.amount || 0);

  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  const growth = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

  return NextResponse.json({
    rep: { id: rep.id, name: rep.name },
    range: {
      start: curStart.toISOString(),
      end: curEnd.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
    },
    metrics: {
      revenue: {
        actual: revenue,
        target: targetRevenue,
        attainmentPct: pct(revenue, targetRevenue),
        growthPct: growth(revenue, revenuePrev),
        currency,
      },
      orders: {
        actual: orders,
        target: targetOrders,
        attainmentPct: pct(orders, targetOrders),
        growthPct: growth(orders, ordersPrev),
      },
      newCustomers: {
        actual: newCustomers,
        target: targetNewCustomers,
        attainmentPct: pct(newCustomers, targetNewCustomers),
      },
    },
    vendors,
  });
}
