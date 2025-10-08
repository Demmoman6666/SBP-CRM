// app/api/reports/rep-scorecard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantUnitCosts } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ----------------- date helpers (UTC, inclusive) ----------------- */
function parseDay(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function startOfDayUTC(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDayUTC(d: Date) {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ----------------- money helpers ----------------- */
function grossFromLines(
  lines: { total: any | null; price: any | null; quantity: number | null }[]
): number {
  let s = 0;
  for (const li of lines) {
    if (li.total != null) s += toNum(li.total);
    else s += toNum(li.price) * (Number(li.quantity ?? 0) || 0);
  }
  return Math.max(0, s);
}
function netExFromOrder(
  o: { subtotal: any | null; discounts: any | null },
  fallbackGrossEx: number
): number {
  const sub = o.subtotal != null ? toNum(o.subtotal) : null;
  if (sub != null && Number.isFinite(sub)) return Math.max(0, sub);
  const disc = toNum(o.discounts);
  return Math.max(0, fallbackGrossEx - disc);
}

/* ----------------- call helpers ----------------- */
const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

function durationMins(log: {
  durationMinutes?: number | null;
  startTime?: Date | null;
  endTime?: Date | null;
}) {
  if (typeof log.durationMinutes === "number" && !isNaN(log.durationMinutes)) {
    return Math.max(0, log.durationMinutes);
  }
  if (log.startTime && log.endTime) {
    const ms = new Date(log.endTime).getTime() - new Date(log.startTime).getTime();
    if (!isNaN(ms) && ms > 0) return Math.round(ms / 60000);
  }
  return 0;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Rep filter: prefer repId (canonical), otherwise legacy rep/staff name
    const repId = (searchParams.get("repId") || "").trim() || null;
    const repName = (searchParams.get("rep") || searchParams.get("staff") || "").trim() || null;

    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    const gte = startOfDayUTC(from);
    const lte = endOfDayUTC(to);

    // Resolve rep name from id (for legacy name filters)
    let repNameResolved: string | null = repName;
    if (repId) {
      const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
      repNameResolved = rep?.name || repNameResolved;
    }

    /* =============== SECTION 1: Sales / Profit / Margin% (ex VAT) =============== */
    const orders = await prisma.order.findMany({
      where: {
        processedAt: { gte, lte },
        // include both linked customers and orphans we can map by shopifyCustomerId
      },
      select: {
        id: true,
        processedAt: true,
        currency: true,
        subtotal: true,
        discounts: true,
        customerId: true,
        shopifyCustomerId: true,
        customer: { select: { id: true, salesRepId: true, salesRep: true } },
        lineItems: { select: { variantId: true, quantity: true, price: true, total: true } },
      },
      orderBy: { processedAt: "asc" },
    });

    // Early out if no data
    if (!orders.length) {
      return NextResponse.json({
        ok: true,
        range: { from: fromStr, to: toStr },
        rep: { id: repId, name: repNameResolved },
        currency: "GBP",
        section1: { salesEx: 0, profit: 0, marginPct: 0 },
        section2: {
          totalCalls: 0,
          coldCalls: 0,
          bookedCalls: 0,
          bookedDemos: 0,
          avgTimePerCallMins: 0,
          avgCallsPerDay: 0,
          activeDays: 0,
        },
        section3: { totalCustomers: 0, newCustomers: 0 },
      });
    }

    // Filter orders to the chosen rep (by canonical id or legacy name)
    const filteredOrders = orders.filter((o) => {
      if (!repId && !repNameResolved) return true;
      const c = o.customer;
      if (!c) return false;
      const idMatch = repId && c.salesRepId ? c.salesRepId === repId : false;
      const nameMatch =
        repNameResolved && c.salesRep
          ? (c.salesRep || "").trim().toLowerCase() === repNameResolved.trim().toLowerCase()
          : false;
      return Boolean(idMatch || nameMatch);
    });

    const allVariantIds = Array.from(
      new Set(
        filteredOrders
          .flatMap((o) => o.lineItems.map((li) => String(li.variantId || "")).filter(Boolean))
      )
    );

    const costMap = new Map<string, number>();
    if (allVariantIds.length) {
      const cached = await prisma.shopifyVariantCost.findMany({
        where: { variantId: { in: allVariantIds } },
        select: { variantId: true, unitCost: true },
      });
      for (const c of cached) costMap.set(String(c.variantId), Number(c.unitCost ?? 0));

      const missing = allVariantIds.filter((v) => !costMap.has(v)).slice(0, 200);
      if (missing.length) {
        try {
          const fetched = await fetchVariantUnitCosts(missing);
          const pairs = Object.entries(fetched || {}) as [string, number | null][];
          for (const [vid, amt] of pairs) {
            if (amt != null && Number.isFinite(amt)) {
              costMap.set(String(vid), Number(amt));
            }
          }
        } catch (e) {
          console.error("[rep-scorecard] fetchVariantUnitCosts failed:", e);
        }
      }
    }

    let salesEx = 0;
    let profit = 0;
    const currency = filteredOrders[0]?.currency || "GBP";

    for (const o of filteredOrders) {
      const grossEx = grossFromLines(o.lineItems);
      const netEx = netExFromOrder({ subtotal: o.subtotal, discounts: o.discounts }, grossEx);

      let cost = 0;
      for (const li of o.lineItems) {
        const vid = String(li.variantId || "");
        if (!vid) continue;
        const unit = costMap.get(vid);
        if (unit == null) continue;
        const qty = Number(li.quantity ?? 0) || 0;
        cost += unit * qty;
      }

      salesEx += netEx;
      const orderProfit = Math.max(0, netEx - cost);
      profit += orderProfit;
    }

    const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;

    /* =============== SECTION 2: Calls =============== */
    const calls = await prisma.callLog.findMany({
      where: {
        createdAt: { gte, lte },
        ...(repNameResolved ? { staff: repNameResolved } : {}),
      },
      select: {
        createdAt: true,
        callType: true,
        durationMinutes: true,
        startTime: true,
        endTime: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const totalCalls = calls.length;
    let coldCalls = 0;
    let bookedCalls = 0;
    let bookedDemos = 0;
    let totalDuration = 0;

    const activeDaysSet = new Set<string>();
    for (const c of calls) {
      const ct = norm(c.callType);
      if (ct.includes("cold")) coldCalls++;
      if (ct.includes("booked call")) bookedCalls++;
      if (ct.includes("booked demo")) bookedDemos++;

      totalDuration += durationMins(c);

      const dayKey = new Date(c.createdAt).toISOString().slice(0, 10); // UTC day
      activeDaysSet.add(dayKey);
    }
    const activeDays = activeDaysSet.size;
    const avgTimePerCallMins = totalCalls ? totalDuration / totalCalls : 0;
    const avgCallsPerDay = activeDays ? totalCalls / activeDays : 0;

    /* =============== SECTION 3: Customers =============== */
    // Total customers assigned to rep
    const totalCustomers = await prisma.customer.count({
      where: {
        OR: [
          ...(repId ? [{ salesRepId: repId }] : []),
          ...(repNameResolved ? [{ salesRep: { equals: repNameResolved } }] : []),
        ],
      },
    });

    const newCustomers = await prisma.customer.count({
      where: {
        createdAt: { gte, lte },
        OR: [
          ...(repId ? [{ salesRepId: repId }] : []),
          ...(repNameResolved ? [{ salesRep: { equals: repNameResolved } }] : []),
        ],
      },
    });

    return NextResponse.json({
      ok: true,
      range: { from: fromStr, to: toStr },
      rep: { id: repId, name: repNameResolved },
      currency,
      section1: {
        salesEx,
        profit,
        marginPct,
      },
      section2: {
        totalCalls,
        coldCalls,
        bookedCalls,
        bookedDemos,
        avgTimePerCallMins,
        avgCallsPerDay,
        activeDays,
      },
      section3: {
        totalCustomers,
        newCustomers,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (err: any) {
    console.error("rep-scorecard error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
