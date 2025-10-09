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
function startOfDayUTC(d: Date) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDayUTC(d: Date)   { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }
const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

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
  durationMinutes?: number | null; startTime?: Date | null; endTime?: Date | null;
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

/* ----------------- one scorecard builder (matches page.tsx shape) ----------------- */
type FlatScorecard = {
  rep: string;
  from: string;
  to: string;
  // Sales
  salesEx: number;
  marginPct: number;
  profit: number;
  // Calls
  totalCalls: number;
  coldCalls: number;
  bookedCalls: number;
  bookedDemos: number;
  avgTimePerCallMins: number;
  avgCallsPerDay: number;
  daysActive: number;
  // Customers
  totalCustomers: number;
  newCustomers: number;
};

async function buildScorecard(repName: string, fromStr: string, toStr: string): Promise<FlatScorecard> {
  const from = parseDay(fromStr)!;
  const to = parseDay(toStr)!;
  const gte = startOfDayUTC(from);
  const lte = endOfDayUTC(to);

  /* ---- SALES ---- */
  let salesEx = 0;
  let profit = 0;

  const orders = await prisma.order.findMany({
    where: { processedAt: { gte, lte } },
    select: {
      currency: true,
      subtotal: true,
      discounts: true,
      customer: { select: { salesRep: true } },
      lineItems: { select: { variantId: true, quantity: true, price: true, total: true } },
    },
    orderBy: { processedAt: "asc" },
  });

  // safest: filter by related name in JS
  const relevantOrders = orders.filter(o =>
    repName ? (o.customer?.salesRep || "").trim().toLowerCase() === repName.trim().toLowerCase() : true
  );

  const allVariantIds = Array.from(
    new Set(
      relevantOrders.flatMap(o =>
        o.lineItems.map(li => String(li.variantId || "")).filter(Boolean)
      )
    )
  );

  const costMap = new Map<string, number>();
  if (allVariantIds.length) {
    try {
      const cached = await prisma.shopifyVariantCost.findMany({
        where: { variantId: { in: allVariantIds } },
        select: { variantId: true, unitCost: true },
      });
      for (const c of cached) costMap.set(String(c.variantId), Number(c.unitCost ?? 0));
    } catch {}
    const missing = allVariantIds.filter(v => !costMap.has(v)).slice(0, 200);
    if (missing.length) {
      try {
        const fetched = await fetchVariantUnitCosts(missing);
        for (const [vid, amt] of Object.entries(fetched || {})) {
          if (amt != null && Number.isFinite(amt)) costMap.set(String(vid), Number(amt));
        }
      } catch {}
    }
  }

  for (const o of relevantOrders) {
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
    profit  += Math.max(0, netEx - cost);
  }

  const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;

  /* ---- CALLS ---- */
  const calls = await prisma.callLog.findMany({
    where: {
      createdAt: { gte, lte },
      ...(repName ? { staff: repName } : {}),
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
  let coldCalls = 0, bookedCalls = 0, bookedDemos = 0;
  let totalDuration = 0;
  const activeDaysSet = new Set<string>();

  for (const c of calls) {
    const ct = norm(c.callType);
    if (ct.includes("cold")) coldCalls++;
    if (ct.includes("booked call")) bookedCalls++;
    if (ct.includes("booked demo")) bookedDemos++;
    totalDuration += durationMins(c);
    activeDaysSet.add(new Date(c.createdAt).toISOString().slice(0,10)); // UTC day
  }
  const daysActive = activeDaysSet.size;
  const avgTimePerCallMins = totalCalls ? totalDuration / totalCalls : 0;
  const avgCallsPerDay = daysActive ? totalCalls / daysActive : 0;

  /* ---- CUSTOMERS ---- */
  const totalCustomers = await prisma.customer.count({
    where: repName ? { salesRep: repName } : {},
  });
  const newCustomers = await prisma.customer.count({
    where: { createdAt: { gte, lte }, ...(repName ? { salesRep: repName } : {}) },
  });

  return {
    rep: repName,
    from: fromStr,
    to: toStr,
    salesEx,
    marginPct,
    profit,
    totalCalls,
    coldCalls,
    bookedCalls,
    bookedDemos,
    avgTimePerCallMins,
    avgCallsPerDay,
    daysActive,
    totalCustomers,
    newCustomers,
  };
}

/* ----------------- route ----------------- */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const rep = (sp.get("rep") || sp.get("staff") || "").trim();
    const fromStr = sp.get("from");
    const toStr   = sp.get("to");

    if (!rep) return NextResponse.json({ error: "rep is required" }, { status: 400 });
    if (!fromStr || !toStr || !parseDay(fromStr) || !parseDay(toStr)) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }

    // optional compare inputs (NOT auto-applied)
    const cmpRep  = (sp.get("cmpRep") || "").trim();
    const cmpFrom = sp.get("cmpFrom");
    const cmpTo   = sp.get("cmpTo");

    const current = await buildScorecard(rep, fromStr, toStr);

    let compare: FlatScorecard | null = null;
    if (cmpRep && cmpFrom && cmpTo && parseDay(cmpFrom) && parseDay(cmpTo)) {
      compare = await buildScorecard(cmpRep, cmpFrom, cmpTo);
    }

    return NextResponse.json({ current, compare }, { headers: { "cache-control": "no-store" } });
  } catch (err: any) {
    console.error("rep-scorecard error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
