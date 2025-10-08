// app/api/reports/rep-scorecard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ---- helpers ---- */
function parseDay(s?: string | null): Date | null {
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
function isBookedDemo(log: { callType?: string | null; outcome?: string | null }) {
  const ct = norm(log.callType);
  const out = norm(log.outcome);
  return ct.includes("demo") || out.includes("demo");
}
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
    const rep = (searchParams.get("rep") || "").trim();
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");

    if (!rep) return NextResponse.json({ error: "Missing rep" }, { status: 400 });
    const from = parseDay(fromStr);
    const to = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json({ error: "Invalid from/to (yyyy-mm-dd)" }, { status: 400 });
    }

    // Inclusive date range
    const gte = from;
    const lt = addDaysUTC(to, 1);

    /* ---------- Calls (by staff = rep) ---------- */
    const callLogs = await prisma.callLog.findMany({
      where: { createdAt: { gte, lt }, staff: rep },
      select: {
        createdAt: true,
        callType: true,
        outcome: true,
        appointmentBooked: true,
        stage: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
      },
    });

    const totalCalls = callLogs.length;
    const coldCalls = callLogs.filter((c) => norm(c.callType).includes("cold")).length;
    const bookedCalls = callLogs.filter(isBooking).length;
    const bookedDemos = callLogs.filter(isBookedDemo).length;

    let totalDur = 0;
    const activeDays = new Set<string>();
    for (const l of callLogs) {
      totalDur += durationMins(l);
      activeDays.add(new Date(l.createdAt).toISOString().slice(0, 10)); // UTC day
    }
    const daysActive = activeDays.size;
    const avgTimePerCallMins = totalCalls ? totalDur / totalCalls : 0;
    const avgCallsPerDay = daysActive ? totalCalls / daysActive : 0;

    /* ---------- Sales (orders via rep’s customers) ---------- */
    // Find customers owned by rep
    const customers = await prisma.customer.findMany({
      where: { salesRep: rep },
      select: { id: true, createdAt: true },
    });
    const custIds = customers.map((c) => c.id);
    // Orders for those customers in range
    const orders = custIds.length
      ? await prisma.order.findMany({
          where: { processedAt: { gte, lt }, customerId: { in: custIds } },
          select: { id: true, subtotal: true },
        })
      : [];

    const orderIds = orders.map((o) => o.id);
    const lineItems = orderIds.length
      ? await prisma.orderLineItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { orderId: true, variantId: true, quantity: true, price: true, total: true },
        })
      : [];

    // Revenue (ex-VAT): prefer order.subtotal; if missing fall back to sum(lines)
    const subtotalByOrder = new Map<string, number>();
    for (const o of orders) {
      const val = typeof o.subtotal === "number" && !isNaN(o.subtotal) ? o.subtotal : 0;
      subtotalByOrder.set(o.id, val);
    }
    const sumLinesByOrder = new Map<string, number>();
    for (const li of lineItems) {
      const v = (typeof li.total === "number" ? li.total : null) ??
                ((typeof li.price === "number" ? li.price : 0) * (li.quantity ?? 0));
      sumLinesByOrder.set(li.orderId, (sumLinesByOrder.get(li.orderId) ?? 0) + (v || 0));
    }
    let salesEx = 0;
    for (const o of orders) {
      const sub = subtotalByOrder.get(o.id) ?? 0;
      salesEx += sub > 0 ? sub : (sumLinesByOrder.get(o.id) ?? 0);
    }

    // Costs: use shopifyVariantCost (unitCost * qty)
    const variantIds = Array.from(
      new Set(lineItems.map((li) => String(li.variantId || "")).filter(Boolean))
    );
    const costs = variantIds.length
      ? await prisma.shopifyVariantCost.findMany({
          where: { variantId: { in: variantIds } },
          select: { variantId: true, unitCost: true },
        })
      : [];
    const costMap = new Map(costs.map((c) => [String(c.variantId), Number(c.unitCost || 0)]));

    let totalCost = 0;
    for (const li of lineItems) {
      const unit = costMap.get(String(li.variantId || "")) ?? 0;
      const qty = li.quantity ?? 0;
      totalCost += unit * qty;
    }

    const profit = salesEx - totalCost;
    const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;

    /* ---------- Customers ---------- */
    const totalCustomers = new Set<string>();
    for (const o of orders) totalCustomers.add(o.id); // order-level unique not good; fix below

    // total customers with orders in the range
    const orderCustomers = orderIds.length
      ? await prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { customerId: true },
        })
      : [];
    const customersWithOrders = new Set(
      orderCustomers.map((x) => x.customerId).filter(Boolean) as string[]
    );

    // new customers (created in range, owned by rep)
    const newCustomers = customers.filter(
      (c) => c.createdAt >= gte && c.createdAt < lt
    ).length;

    const payload = {
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
      totalCustomers: customersWithOrders.size,
      newCustomers,
    };

    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (err: any) {
    console.error("[rep-scorecard] error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
