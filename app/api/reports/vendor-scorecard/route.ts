// app/api/reports/vendor-scorecard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type ScoreRow = {
  vendor: string;
  revenue: number;
  orders: number;
  customers: number;
  aov: number;
};

function parseDate(s?: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * GET /api/reports/vendor-scorecard?start=yyyy-mm-dd&end=yyyy-mm-dd&vendors=a,b,c
 * - If vendors omitted, uses all StockedBrand names.
 * - Date range is inclusive of start, exclusive of end+1 (i.e. [start, end]).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const startStr = url.searchParams.get("start");
  const endStr = url.searchParams.get("end");
  const vendorsParam = url.searchParams.get("vendors");

  // Dates: default last 90 days
  const end = endStr ? addDays(startOfDay(new Date(endStr)), 1) : addDays(startOfDay(new Date()), 1);
  const start = startStr ? startOfDay(new Date(startStr)) : addDays(end, -90);

  // Vendors list (canonical)
  let vendorNames: string[] = [];
  if (vendorsParam) {
    vendorNames = vendorsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    // All StockedBrand names
    const brands = await prisma.stockedBrand.findMany({ select: { name: true }, orderBy: { name: "asc" } });
    vendorNames = brands.map((b) => b.name);
  }

  // If nothing, return early
  if (!vendorNames.length) {
    return NextResponse.json({
      params: { start: startStr, end: endStr, vendors: [] as string[] },
      summary: { revenue: 0, orders: 0, customers: 0 },
      byVendor: [] as ScoreRow[],
      timeseries: [] as { period: string; vendor: string; revenue: number }[],
    });
  }

  // 1) Revenue per vendor (sum of OrderLineItem.total)
  //    We use a groupBy on OrderLineItem, filtered by Order.processedAt range and vendor IN list
  const perVendor = await prisma.orderLineItem.groupBy({
    by: ["productVendor"],
    where: {
      productVendor: { in: vendorNames },
      order: {
        is: {
          processedAt: { gte: start, lt: end },
        },
      },
    },
    _sum: { total: true },
  });

  // Helper to count distinct orders & customers per vendor
  async function vendorCounts(vendor: string) {
    const ordersDistinct = await prisma.order.findMany({
      where: {
        processedAt: { gte: start, lt: end },
        lineItems: { some: { productVendor: vendor } },
      },
      select: { id: true, customerId: true },
    });
    const orderIds = new Set(ordersDistinct.map((o) => o.id));
    const customerIds = new Set(ordersDistinct.map((o) => o.customerId).filter(Boolean));
    return { orders: orderIds.size, customers: customerIds.size };
  }

  // Assemble rows for requested vendors only (including vendors with zero revenue)
  const rows: ScoreRow[] = [];
  let grandRevenue = 0;
  let grandOrders = 0;
  let grandCustomers = 0;

  // Map revenue sums for quick lookup
  const revenueMap = new Map<string, number>();
  for (const g of perVendor) {
    const v = g.productVendor ?? "";
    const sum = (g._sum.total as unknown as Prisma.Decimal | null) ?? null;
    const num = sum ? Number(sum) : 0;
    if (v) revenueMap.set(v, num);
  }

  for (const name of vendorNames) {
    const revenue = revenueMap.get(name) ?? 0;
    const { orders, customers } = await vendorCounts(name);
    const aov = orders > 0 ? revenue / orders : 0;
    grandRevenue += revenue;
    grandOrders += orders;
    grandCustomers += customers;
    rows.push({ vendor: name, revenue, orders, customers, aov });
  }

  rows.sort((a, b) => b.revenue - a.revenue);

  // 2) Timeseries: revenue by month per vendor
  //    Use a raw query for efficiency (date_trunc + join)
  const ts = await prisma.$queryRaw<
    { period: string; vendor: string; revenue: string }[]
  >`
    SELECT to_char(date_trunc('month', o."processedAt"), 'YYYY-MM') AS period,
           oli."productVendor" AS vendor,
           COALESCE(SUM(oli.total), 0)::text AS revenue
    FROM "OrderLineItem" oli
    JOIN "Order" o ON o.id = oli."orderId"
    WHERE o."processedAt" >= ${start}
      AND o."processedAt" < ${end}
      AND oli."productVendor" IN (${Prisma.join(vendorNames)})
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `;

  const timeseries = ts.map((r) => ({
    period: r.period,
    vendor: r.vendor,
    revenue: parseFloat(r.revenue || "0"),
  }));

  return NextResponse.json({
    params: { start: startStr, end: endStr, vendors: vendorNames },
    summary: { revenue: grandRevenue, orders: grandOrders, customers: grandCustomers },
    byVendor: rows,
    timeseries,
  });
}
