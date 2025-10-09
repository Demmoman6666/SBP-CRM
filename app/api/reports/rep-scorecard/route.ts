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

    // Resolve name from id when possible (keeps legacy name filters working)
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
          subtotal: true,
          discounts: true,
          customerId: true,
          customer: { select: { salesRep: true, salesRepId: true } },
          lineItems: { select: { variantId: true, quantity: true, price: true, total: true } },
        },
        orderBy: { processedAt: "asc" },
      });

      // Keep orders for this rep (by related name/id OR by customerId fallback)
      const relevantOrders = orders.filter((o) => {
        if (!repId && !repNameResolved) return true; // no rep filter
        const hasMatchByRel =
          (!!repId && o.customer?.salesRepId === repId) ||
          (!!repNameResolved &&
            !!o.customer?.salesRep &&
            o.customer.salesRep.trim().toLowerCase() === repNameResolved.trim().toLowerCase());
        const hasMatchByCustomerId =
          !!o.customerId && repCustomerIdSet.has(String(o.customerId));
        return hasMatchByRel || hasMatchByCustomerId;
      });

      if (relevantOrders.length > 0) {
        currency = relevantOrders[0]?.currency || currency;

        const allVariantIds = Array.from(
          new Set(
            relevantOrders
              .flatMap((o) => o.lineItems.map((li) => String(li.variantId || "")).filter(Boolean))
          )
        );

        const costMap = new Map<string, number>();
        if (allVariantIds.length) {
          // cached costs
          try {
            const cached = await prisma.shopifyVariantCost.findMany({
              where: { variantId: { in: allVariantIds } },
              select: { variantId: true, unitCost: true },
            });
            for (const c of cached) costMap.set(String(c.variantId), Number(c.unitCost ?? 0));
          } catch {}

          // fetch missing (best-effort)
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
          const grossEx = grossFromLines(o.lineItems);
          const netEx   = netExFromOrder({ subtotal: o.subtotal, discounts: o.discounts }, grossEx);

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
              // case-insensitive equality
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
