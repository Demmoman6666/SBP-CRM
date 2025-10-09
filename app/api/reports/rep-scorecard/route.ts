// app/api/reports/rep-scorecard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ────────────── date helpers (UTC, inclusive [from..to]) ────────────── */
function parseDay(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function addDaysUTC(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const dayKeyUTC = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);

/* ────────────── string + call helpers ────────────── */
const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

function isBooking(log: {
  appointmentBooked?: boolean | null;
  outcome?: string | null;
  callType?: string | null;
  stage?: string | null;
}) {
  if (log.appointmentBooked) return true;
  const out = norm(log.outcome);
  if (out === "appointment booked" || out.startsWith("appointment booked")) return true;
  if ((log.stage ?? "").toUpperCase() === "APPOINTMENT_BOOKED") return true;
  const ct = norm(log.callType);
  if (ct.includes("booked")) return true; // "Booked Call", etc
  return false;
}
function isColdCall(callType?: string | null) {
  const ct = norm(callType);
  return !!ct && (ct === "cold call" || ct.includes("cold"));
}
function isBookedDemo(callType?: string | null, outcome?: string | null) {
  const ct = norm(callType);
  const out = norm(outcome);
  return ct.includes("demo") || out.includes("demo");
}
function durationMins(log: {
  durationMinutes?: number | null;
  startTime?: Date | null;
  endTime?: Date | null;
}) {
  if (typeof log.durationMinutes === "number" && !isNaN(log.durationMinutes))
    return Math.max(0, log.durationMinutes);
  if (log.startTime && log.endTime) {
    const ms = new Date(log.endTime).getTime() - new Date(log.startTime).getTime();
    if (!isNaN(ms) && ms > 0) return Math.round(ms / 60000);
  }
  return 0;
}

/* ────────────── score computation ────────────── */
type Scorecard = {
  rep: string;
  from: string;
  to: string;

  // Section 1 — Sales
  salesEx: number; // ex VAT
  marginPct: number;
  profit: number;

  // Section 2 — Calls
  totalCalls: number;
  coldCalls: number;
  bookedCalls: number;
  bookedDemos: number;
  avgTimePerCallMins: number;
  avgCallsPerDay: number;
  daysActive: number;

  // Section 3 — Customers
  totalCustomers: number;
  newCustomers: number;
};

async function computeForRep(repName: string, fromStr: string, toStr: string): Promise<Scorecard> {
  const from = parseDay(fromStr)!;
  const to = parseDay(toStr)!;
  const gte = from;
  const lt = addDaysUTC(to, 1);

  /* ---------- SALES & PROFIT (ex VAT) ----------
     We attribute orders to a rep via the linked Customer.salesRep.
     Revenue is summed from line items (ex VAT).
     Costs come from ShopifyVariantCost (if available).
  */
  const orders = await prisma.order.findMany({
    where: {
      processedAt: { gte, lt },
      customer: { salesRep: repName },
    },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  let salesEx = 0;
  let profit = 0;

  if (orderIds.length) {
    const lines = await prisma.orderLineItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { variantId: true, quantity: true, total: true, price: true },
    });

    const variantIds = Array.from(
      new Set(lines.map((l) => (l.variantId ? String(l.variantId) : "")).filter(Boolean))
    );
    const costs = variantIds.length
      ? await prisma.shopifyVariantCost.findMany({
          where: { variantId: { in: variantIds } },
          select: { variantId: true, unitCost: true },
        })
      : [];
    const costMap = new Map<string, number | null>(
      costs.map((c) => [String(c.variantId), c.unitCost == null ? null : Number(c.unitCost)])
    );

    for (const li of lines) {
      const qty = Number(li.quantity || 0);
      const revenueLine =
        li.total != null ? Number(li.total) : li.price != null ? Number(li.price) * qty : 0;
      salesEx += revenueLine;

      const unitCost =
        li.variantId != null ? costMap.get(String(li.variantId)) ?? null : null;
      const extCost = unitCost != null ? unitCost * qty : 0;
      profit += revenueLine - extCost;
    }
  }
  const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;

  /* ---------- CALLS ---------- */
  const calls = await prisma.callLog.findMany({
    where: {
      createdAt: { gte, lt },
      OR: [{ staff: repName }, { rep: { name: repName } }],
    },
    select: {
      callType: true,
      outcome: true,
      appointmentBooked: true,
      stage: true,
      startTime: true,
      endTime: true,
      durationMinutes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const totalCalls = calls.length;
  let coldCalls = 0;
  let bookedCalls = 0;
  let bookedDemos = 0;
  let totalDur = 0;
  const activeDays = new Set<string>();

  for (const c of calls) {
    if (isColdCall(c.callType)) coldCalls++;
    if (isBooking(c)) bookedCalls++;
    if (isBookedDemo(c.callType, c.outcome)) bookedDemos++;
    totalDur += durationMins(c);
    activeDays.add(dayKeyUTC(new Date(c.createdAt)));
  }

  const daysActive = activeDays.size;
  const avgTimePerCallMins = totalCalls ? totalDur / totalCalls : 0;
  const avgCallsPerDay = daysActive ? totalCalls / daysActive : 0;

  /* ---------- CUSTOMERS ---------- */
  const [totalCustomers, newCustomers] = await Promise.all([
    prisma.customer.count({ where: { salesRep: repName } }),
    prisma.customer.count({
      where: { salesRep: repName, createdAt: { gte, lt } },
    }),
  ]);

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

/* ────────────── route ────────────── */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const rep = (searchParams.get("rep") || "").trim();
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");

    if (!rep) {
      return NextResponse.json({ error: "Missing ?rep=<Sales Rep name>" }, { status: 400 });
    }
    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json(
        { error: "Invalid or missing ?from/&?to (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const base = await computeForRep(rep, fromStr!, toStr!);

    // Optional comparison
    const cmpRep = (searchParams.get("cmpRep") || "").trim();
    const cmpFromStr = searchParams.get("cmpFrom");
    const cmpToStr = searchParams.get("cmpTo");

    let compare: Scorecard | null = null;
    if (cmpRep && cmpFromStr && cmpToStr && parseDay(cmpFromStr) && parseDay(cmpToStr)) {
      compare = await computeForRep(cmpRep, cmpFromStr, cmpToStr);
    }

    return NextResponse.json({ ok: true, base, compare }, { headers: { "cache-control": "no-store" } });
  } catch (err: any) {
    console.error("[rep-scorecard] error:", err?.stack || err?.message || err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
