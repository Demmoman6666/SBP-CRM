// app/api/scorecards/rep/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// Parse YYYY-MM or full ISO; for YYYY-MM use local month start (no Z)
function parseStart(v: string | null): Date | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}$/.test(v)) return new Date(`${v}-01T00:00:00`);
  const d = new Date(v);
  return isNaN(+d) ? null : d;
}
function endOfMonthLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Ex-VAT net revenue for an order (discounts applied, taxes & shipping excluded) */
function exVatForOrder(o: {
  subtotal: any | null;
  total: any | null;
  taxes: any | null;
  shipping: any | null;
  discounts: any | null; // kept for completeness; not double-counted
  lineItems?: { total: any | null; price: any | null; quantity: number | null }[];
}): number {
  const num = (x: any) => (x == null ? null : Number(x));
  const sub = num(o.subtotal);
  const tax = num(o.taxes) ?? 0;
  const shp = num(o.shipping) ?? 0;
  const tot = num(o.total);

  // Preferred: Shopify subtotal_price minus taxes (discounts are already in subtotal)
  if (sub != null && isFinite(sub)) {
    return Math.max(0, sub - (tax || 0));
  }

  // Fallback: total - shipping - taxes (discounts already included in total)
  if (tot != null && isFinite(tot)) {
    return Math.max(0, tot - shp - tax);
  }

  // Last resort: sum line totals (assumed discount-adjusted) or price*qty
  if (o.lineItems && o.lineItems.length) {
    let s = 0;
    for (const li of o.lineItems) {
      const lt = num(li.total);
      if (lt != null && isFinite(lt)) s += lt;
      else {
        const p = num(li.price) ?? 0;
        const q = Number(li.quantity ?? 0) || 0;
        s += p * q;
      }
    }
    return Math.max(0, s);
  }

  return 0;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repId = searchParams.get("repId");
  const start = parseStart(searchParams.get("start") || searchParams.get("month"));
  let end = searchParams.get("end") ? new Date(String(searchParams.get("end"))) : null;
  if (start && !end) end = endOfMonthLocal(start);

  if (!repId || !start || !end || isNaN(+end)) {
    return NextResponse.json({ error: "repId, start/month, and end are required" }, { status: 400 });
  }

  // canonical rep (needed for legacy-name fallback too)
  const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
  if (!rep) return NextResponse.json({ error: "Rep not found" }, { status: 404 });

  // current window [start, end]
  const curStart = start;
  const curEnd = end;

  // previous window with same length
  const days = Math.ceil((+curEnd - +curStart) / 86400000) + 1;
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -(days - 1));

  // ✅ Include ALL financial statuses (paid + unpaid). No filter here.
  const whereByRepCurrent: Prisma.OrderWhereInput = {
    processedAt: { gte: curStart, lte: curEnd },
    OR: [
      { customer: { repId } },              // canonical
      { customer: { salesRep: rep.name } }, // legacy fallback
    ],
  };

  const whereByRepPrev: Prisma.OrderWhereInput = {
    processedAt: { gte: prevStart, lte: prevEnd },
    OR: [
      { customer: { repId } },
      { customer: { salesRep: rep.name } },
    ],
  };

  // Fetch orders (current & prev) with fields needed for ex-VAT calc + vendor breakdown
  const [curOrders, prevOrders] = await Promise.all([
    prisma.order.findMany({
      where: whereByRepCurrent,
      select: {
        id: true,
        processedAt: true,
        currency: true,
        subtotal: true,
        total: true,
        taxes: true,
        shipping: true,
        discounts: true,
        lineItems: { select: { productVendor: true, total: true, price: true, quantity: true } },
        customerId: true,
      },
    }),
    prisma.order.findMany({
      where: whereByRepPrev,
      select: {
        id: true,
        processedAt: true,
        currency: true,
        subtotal: true,
        total: true,
        taxes: true,
        shipping: true,
        discounts: true,
        lineItems: { select: { total: true, price: true, quantity: true } },
      },
    }),
  ]);

  // revenue totals (ex-VAT & after discounts)
  const revenue = curOrders.reduce((a, o) => a + exVatForOrder(o), 0);
  const revenuePrev = prevOrders.reduce((a, o) => a + exVatForOrder(o), 0);
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
      where: {
        customerId: { in: customerIds },
        OR: [
          { customer: { repId } },
          { customer: { salesRep: rep.name } },
        ],
      },
      _min: { processedAt: true },
    });
    newCustomers = earliest.filter((g) => {
      const first = g._min.processedAt;
      return first && first >= curStart && first <= curEnd;
    }).length;
  }

  // Vendor breakdown: distribute each order's ex-VAT across its lines proportionally
  const vendorMap: Record<string, number> = {};
  for (const o of curOrders) {
    const orderExVat = exVatForOrder(o);
    // sum line "amounts" to get proportions
    let lineSum = 0;
    const lines = (o.lineItems || []).map((li) => {
      const amt = li.total != null ? Number(li.total) : (Number(li.price ?? 0) * (Number(li.quantity ?? 0) || 0));
      const safeAmt = isFinite(amt) ? Math.max(0, amt) : 0;
      lineSum += safeAmt;
      return { vendor: (li.productVendor || "").trim() || "—", amt: safeAmt };
    });
    if (orderExVat > 0 && lineSum > 0) {
      for (const li of lines) {
        const share = (li.amt / lineSum) * orderExVat;
        vendorMap[li.vendor] = (vendorMap[li.vendor] || 0) + share;
      }
    }
  }
  const vendors = Object.entries(vendorMap)
    .sort((a, b) => b[1] - a[1])
    .map(([vendor, revenue]) => ({ vendor, revenue }));

  // targets for this exact period & rep
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
