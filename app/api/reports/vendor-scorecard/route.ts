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
  prevRevenue: number;
  growthPct: number | null; // null when previous period is 0
};

function parseYMD(s?: string | null) {
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const startStr = url.searchParams.get("start");
  const endStr = url.searchParams.get("end");
  const vendorsParam = url.searchParams.get("vendors");
  const repsParam = url.searchParams.get("reps");

  // Dates (default: last 90 days)
  const endInclusive = parseYMD(endStr) ?? new Date();
  const end = addDays(startOfDay(endInclusive), 1); // exclusive
  const start = startOfDay(parseYMD(startStr) ?? addDays(end, -90));

  // Previous period [startPrev, endPrev)
  const msRange = +end - +start;
  const startPrev = new Date(+start - msRange);
  const endPrev = new Date(+start);

  // Vendors
  let vendorNames: string[] = [];
  if (vendorsParam) {
    vendorNames = vendorsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    const brands = await prisma.stockedBrand.findMany({
      select: { name: true },
      orderBy: { name: "asc" },
    });
    vendorNames = brands.map((b) => b.name);
  }

  // Reps (filter by Customer.salesRep)
  const reps = repsParam
    ? repsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  if (vendorNames.length === 0) {
    return NextResponse.json({
      params: { start: startStr, end: endStr, vendors: [] as string[], reps: [] as string[] },
      summary: { revenue: 0, orders: 0, customers: 0 },
      byVendor: [] as ScoreRow[],
      timeseries: [] as { period: string; vendor: string; revenue: number }[],
    });
  }

  const repClause =
    reps.length > 0
      ? Prisma.sql`AND c."salesRep" IN (${Prisma.join(reps)})`
      : Prisma.sql``;

  // ---------- Current period (revenue, orders, customers) ----------
  const currRows = await prisma.$queryRaw<
    { vendor: string; revenue: string; orders: bigint; customers: bigint }[]
  >`
    SELECT
      oli."productVendor" AS vendor,
      COALESCE(SUM(oli.total), 0)::text AS revenue,
      COUNT(DISTINCT o.id) AS orders,
      COUNT(DISTINCT o."customerId") AS customers
    FROM "OrderLineItem" oli
    JOIN "Order" o ON o.id = oli."orderId"
    LEFT JOIN "Customer" c ON c.id = o."customerId"
    WHERE o."processedAt" >= ${start}
      AND o."processedAt" < ${end}
      AND oli."productVendor" IN (${Prisma.join(vendorNames)})
      ${repClause}
    GROUP BY oli."productVendor"
  `;

  // ---------- Previous period (revenue only) ----------
  const prevRows = await prisma.$queryRaw<
    { vendor: string; revenue: string }[]
  >`
    SELECT
      oli."productVendor" AS vendor,
      COALESCE(SUM(oli.total), 0)::text AS revenue
    FROM "OrderLineItem" oli
    JOIN "Order" o ON o.id = oli."orderId"
    LEFT JOIN "Customer" c ON c.id = o."customerId"
    WHERE o."processedAt" >= ${startPrev}
      AND o."processedAt" < ${endPrev}
      AND oli."productVendor" IN (${Prisma.join(vendorNames)})
      ${repClause}
    GROUP BY oli."productVendor"
  `;

  // ---------- Timeseries (monthly, filtered by reps if any) ----------
  const ts = await prisma.$queryRaw<
    { period: string; vendor: string; revenue: string }[]
  >`
    SELECT
      to_char(date_trunc('month', o."processedAt"), 'YYYY-MM') AS period,
      oli."productVendor" AS vendor,
      COALESCE(SUM(oli.total), 0)::text AS revenue
    FROM "OrderLineItem" oli
    JOIN "Order" o ON o.id = oli."orderId"
    LEFT JOIN "Customer" c ON c.id = o."customerId"
    WHERE o."processedAt" >= ${start}
      AND o."processedAt" < ${end}
      AND oli."productVendor" IN (${Prisma.join(vendorNames)})
      ${repClause}
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `;

  // ---------- Assemble score rows (include vendors with zeroes) ----------
  const currMap = new Map<string, { revenue: number; orders: number; customers: number }>();
  for (const r of currRows) {
    currMap.set(r.vendor, {
      revenue: parseFloat(r.revenue || "0"),
      orders: Number(r.orders || 0),
      customers: Number(r.customers || 0),
    });
  }
  const prevMap = new Map<string, number>();
  for (const r of prevRows) prevMap.set(r.vendor, parseFloat(r.revenue || "0"));

  let totalRevenue = 0;
  let totalOrders = 0;
  let totalCustomers = 0;

  const byVendor: ScoreRow[] = vendorNames.map((name) => {
    const cur = currMap.get(name) || { revenue: 0, orders: 0, customers: 0 };
    const prevRevenue = prevMap.get(name) ?? 0;
    const aov = cur.orders > 0 ? cur.revenue / cur.orders : 0;
    const growthPct =
      prevRevenue > 0 ? ((cur.revenue - prevRevenue) / prevRevenue) * 100 : (cur.revenue > 0 ? null : 0);

    totalRevenue += cur.revenue;
    totalOrders += cur.orders;
    totalCustomers += cur.customers;

    return {
      vendor: name,
      revenue: cur.revenue,
      orders: cur.orders,
      customers: cur.customers,
      aov,
      prevRevenue,
      growthPct,
    };
  });

  byVendor.sort((a, b) => b.revenue - a.revenue);

  const timeseries = ts.map((r) => ({
    period: r.period,
    vendor: r.vendor,
    revenue: parseFloat(r.revenue || "0"),
  }));

  return NextResponse.json({
    params: {
      start: startStr,
      end: endStr,
      vendors: vendorNames,
      reps,
      prevRange: {
        start: startPrev.toISOString(),
        end: endPrev.toISOString(),
      },
    },
    summary: { revenue: totalRevenue, orders: totalOrders, customers: totalCustomers },
    byVendor,
    timeseries,
  });
}
