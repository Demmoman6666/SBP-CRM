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

/* ----------------- revenue helpers (live/exchange-aware) ----------------- */
function sumLinesEx(
  lines: { total: any | null; price: any | null; quantity: number | null }[]
): number {
  let s = 0;
  for (const li of lines) {
    if (li.total != null) s += toNum(li.total);
    else s += toNum(li.price) * (Number(li.quantity ?? 0) || 0);
  }
  return Math.max(0, s);
}
const approxEq = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

/**
 * Compute effective ex-VAT revenue for an order *after* refunds/returns/exchanges.
 * Priority:
 *   1) Use “current*” fields if present (Shopify edited orders).
 *   2) Otherwise start from original values + subtract aggregated/detailed refunds.
 *   3) If no monetary refunds are present but line items have refundedQuantity,
 *      fall back to a proportional discount allocation based on kept quantity.
 *
 * Returns { netEx, grossEx, discountsUsed } (all ex VAT).
 */
function liveNetExFromOrder(
  o: any,
  lines: { price: any | null; total: any | null; quantity: number | null; refundedQuantity?: number | null }[]
): { netEx: number; grossEx: number; discountsUsed: number } {
  // 1) Prefer current* numbers if your DB has them
  const curSubtotal = toNum(o?.currentSubtotal ?? o?.currentSubtotalExVat);
  const curDiscounts = toNum(o?.currentDiscounts ?? o?.currentTotalDiscounts);

  // 2) Originals
  const origSubtotal = toNum(o?.subtotal);   // ex VAT AFTER discounts
  const origDiscounts = toNum(o?.discounts); // ex VAT

  const baseSubtotal = curSubtotal || origSubtotal || 0;
  const baseDiscounts = curDiscounts || origDiscounts || 0;

  // Gross from line items (original)
  const lineSumOriginal = sumLinesEx(lines);

  // If the stored subtotal matches line sum, accept as is; else derive from lines.
  let grossExBase: number;
  let netExBase: number;
  if (baseSubtotal && approxEq(baseSubtotal, lineSumOriginal)) {
    netExBase = Math.max(0, baseSubtotal);
    grossExBase = Math.max(0, netExBase + baseDiscounts);
  } else {
    grossExBase = Math.max(0, lineSumOriginal);
    netExBase = Math.max(0, grossExBase - baseDiscounts);
  }

  // Refunds (monetary)
  const aggRefundNet = toNum(o?.refundedNet);

  // Detailed refunds (if you store Shopify JSON; safe if absent)
  let detRefundNet = 0;
  const refunds = o?.refunds || o?.Refunds;
  if (Array.isArray(refunds)) {
    for (const rf of refunds) {
      const items = rf?.refundLineItems || rf?.refund_line_items;
      if (Array.isArray(items)) {
        for (const it of items) {
          detRefundNet +=
            toNum(it?.subtotal) || toNum(it?.subtotal_set?.shop_money?.amount);
        }
      }
      const adjs = rf?.orderAdjustments || rf?.order_adjustments;
      if (Array.isArray(adjs)) for (const adj of adjs) detRefundNet += toNum(adj?.amount);
    }
  }

  const totalRefundNet = aggRefundNet + detRefundNet;

  // 3) If we have a monetary refund figure, subtract it directly.
  if (totalRefundNet > 0) {
    const netEx = Math.max(0, netExBase - totalRefundNet);
    const grossEx = Math.max(0, grossExBase - totalRefundNet);
    return { netEx, grossEx, discountsUsed: baseDiscounts };
  }

  // 4) Fallback: proportional adjustment by refundedQuantity (exchanges with no refund rows)
  const anyRefundQty = lines.some((li) => Number(li.refundedQuantity ?? 0) > 0);
  if (anyRefundQty && lineSumOriginal > 0) {
    const keptSum = lines.reduce((s, li) => {
      const qty = Number(li.quantity ?? 0) || 0;
      const rqty = Number(li.refundedQuantity ?? 0) || 0;
      const kept = Math.max(0, qty - rqty);
      const unit = li.total != null
        ? toNum(li.total) / Math.max(1, qty) // prefer per-line total
        : toNum(li.price);
      return s + unit * kept;
    }, 0);

    // Allocate the original order-level discount proportionally to what's kept.
    const ratio = Math.max(0, Math.min(1, keptSum / lineSumOriginal));
    const effectiveDiscount = baseDiscounts * ratio;

    const grossEx = Math.max(0, keptSum);
    const netEx = Math.max(0, keptSum - effectiveDiscount);
    return { netEx, grossEx, discountsUsed: effectiveDiscount };
  }

  // 5) Default
  return { netEx: netExBase, grossEx: grossExBase, discountsUsed: baseDiscounts };
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

/* ----------------- route ----------------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Prefer repId (if provided), else fall back to legacy name ("rep"/"staff")
    const repId = (searchParams.get("repId") || "").trim() || null;
    const repNameParam =
      (searchParams.get("rep") || searchParams.get("staff") || "").trim() || null;

    const fromStr = searchParams.get("from");
    const toStr   = searchParams.get("to");
    const from = parseDay(fromStr);
    const to   = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    const gte = startOfDayUTC(from);
    const lte = endOfDayUTC(to);

    // Resolve name from id (keeps legacy name filters working)
    let repNameResolved: string | null = repNameParam;
    if (repId) {
      try {
        const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
        repNameResolved = rep?.name || repNameResolved;
      } catch {}
    }

    /* ===== Preload the rep’s customer IDs (for robust order filtering) ===== */
    let repCustomerIdSet = new Set<string>();
    if (repId || repNameResolved) {
      const custs = await prisma.customer.findMany({
        where: {
          OR: [
            ...(repId ? [{ salesRepId: repId }] : []),
            ...(repNameResolved
              ? [{ salesRep: { equals: repNameResolved, mode: "insensitive" as const } }]
              : []),
          ],
        },
        select: { id: true },
      });
      repCustomerIdSet = new Set(custs.map((c) => String(c.id)));
    }

    /* =============== SECTION 1: Sales / Profit / Margin% (ex VAT) =============== */
    let salesEx = 0;
    let profit = 0;
    let currency = "GBP";

    try {
      const orders = await prisma.order.findMany({
        where: { processedAt: { gte, lte } },
        select: {
          id: true,
          processedAt: true,
          currency: true,

          // base revenue fields (original)
          subtotal: true,        // ex VAT AFTER discounts
          discounts: true,       // ex VAT
          taxes: true,           // VAT

          // “current*” if your sync stores them (optional)
          currentSubtotal: true,
          currentSubtotalExVat: true,
          currentDiscounts: true,
          currentTotalDiscounts: true,

          // refunds (aggregated)
          refundedNet: true,     // ex VAT
          refundedTax: true,

          customerId: true,
          customer: { select: { salesRep: true, salesRepId: true } },

          // include refundedQuantity for cost adjustment
          lineItems: {
            select: {
              variantId: true,
              quantity: true,
              refundedQuantity: true,
              price: true,
              total: true,
            },
          },
        },
        orderBy: { processedAt: "asc" },
      });

      // Filter to orders for this rep
      const relevantOrders = orders.filter((o) => {
        if (!repId && !repNameResolved) return true;
        const matchRel =
          (!!repId && o.customer?.salesRepId === repId) ||
          (!!repNameResolved &&
            !!o.customer?.salesRep &&
            o.customer.salesRep.trim().toLowerCase() === repNameResolved.trim().toLowerCase());
        const matchCust = !!o.customerId && repCustomerIdSet.has(String(o.customerId));
        return matchRel || matchCust;
      });

      if (relevantOrders.length > 0) {
        currency = relevantOrders[0]?.currency || currency;

        // Pull / backfill costs
        const allVariantIds = Array.from(
          new Set(
            relevantOrders.flatMap((o) =>
              o.lineItems.map((li) => String(li.variantId || "")).filter(Boolean)
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
          const missing = allVariantIds.filter((v) => !costMap.has(v)).slice(0, 200);
          if (missing.length) {
            try {
              const fetched = await fetchVariantUnitCosts(missing);
              for (const [vid, amt] of Object.entries(fetched || {})) {
                if (amt != null && Number.isFinite(amt)) costMap.set(String(vid), Number(amt));
              }
            } catch (e) {
              console.error("[rep-scorecard] fetchVariantUnitCosts failed:", e);
            }
          }
        }

        for (const o of relevantOrders) {
          // LIVE revenue (handles returns/exchanges)
          const { netEx } = liveNetExFromOrder(o as any, o.lineItems);

          // Cost on *kept* quantity
          let cost = 0;
          for (const li of o.lineItems) {
            const vid = String(li.variantId || "");
            if (!vid) continue;
            const unit = costMap.get(vid);
            if (unit == null) continue;
            const qty = Number(li.quantity ?? 0) || 0;
            const rqty = Number(li.refundedQuantity ?? 0) || 0;
            const kept = Math.max(0, qty - rqty);
            cost += unit * kept;
          }

          salesEx += netEx;
          profit  += Math.max(0, netEx - cost);
        }
      }
    } catch (e) {
      console.error("[rep-scorecard] orders section failed:", e);
    }

    const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;

    /* =============== SECTION 2: Calls (case-insensitive staff match) =============== */
    let totalCalls = 0, coldCalls = 0, bookedCalls = 0, bookedDemos = 0;
    let totalDuration = 0, activeDays = 0, avgTimePerCallMins = 0, avgCallsPerDay = 0;

    try {
      const where =
        repNameResolved
          ? {
              createdAt: { gte, lte },
              staff: { equals: repNameResolved, mode: "insensitive" as const },
            }
          : { createdAt: { gte, lte } };

      const calls = await prisma.callLog.findMany({
        where,
        select: {
          createdAt: true,
          callType: true,
          durationMinutes: true,
          startTime: true,
          endTime: true,
        },
        orderBy: { createdAt: "asc" },
      });

      totalCalls = calls.length;

      const activeDaysSet = new Set<string>();
      for (const c of calls) {
        const ct = norm(c.callType);
        if (ct.includes("cold")) coldCalls++;
        if (ct.includes("booked call")) bookedCalls++;
        if (ct.includes("booked demo")) bookedDemos++;

        totalDuration += durationMins(c);

        const dayKey = new Date(c.createdAt).toISOString().slice(0, 10); // UTC YYYY-MM-DD
        activeDaysSet.add(dayKey);
      }
      activeDays = activeDaysSet.size;
      avgTimePerCallMins = totalCalls ? totalDuration / totalCalls : 0;
      avgCallsPerDay = activeDays ? totalCalls / activeDays : 0;
    } catch (e) {
      console.error("[rep-scorecard] calls section failed:", e);
    }

    /* =============== SECTION 3: Customers (case-insensitive) =============== */
    let totalCustomers = 0, newCustomers = 0;
    try {
      totalCustomers = await prisma.customer.count({
        where: repNameResolved
          ? { salesRep: { equals: repNameResolved, mode: "insensitive" } }
          : repId
          ? { salesRepId: repId }
          : {},
      });
      newCustomers = await prisma.customer.count({
        where: {
          createdAt: { gte, lte },
          ...(repNameResolved
            ? { salesRep: { equals: repNameResolved, mode: "insensitive" as const } }
            : repId
            ? { salesRepId: repId }
            : {}),
        },
      });
    } catch (e) {
      console.error("[rep-scorecard] customers section failed:", e);
    }

    return NextResponse.json(
      {
        ok: true,
        range: { from: fromStr, to: toStr },
        rep: { id: repId, name: repNameResolved },
        currency,
        section1: { salesEx, profit, marginPct },
        section2: {
          totalCalls, coldCalls, bookedCalls, bookedDemos,
          avgTimePerCallMins, avgCallsPerDay, activeDays,
        },
        section3: { totalCustomers, newCustomers },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err: any) {
    console.error("rep-scorecard error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
