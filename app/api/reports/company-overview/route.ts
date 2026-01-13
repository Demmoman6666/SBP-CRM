// app/api/reports/company-overview/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantUnitCosts } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Compute effective ex-VAT revenue for an order after returns/exchanges.
 * Uses:
 *  - original subtotal/discounts
 *  - aggregated refundedNet (ex VAT)
 *  - refundedQuantity on line items (for exchanges without monetary refund)
 */
function liveNetExFromOrder(
  o: any,
  lines: { price: any | null; total: any | null; quantity: number | null; refundedQuantity?: number | null }[]
): { netEx: number; grossEx: number; discountsUsed: number } {
  // Originals from DB
  const origSubtotal = toNum(o?.subtotal);   // ex VAT AFTER discounts
  const origDiscounts = toNum(o?.discounts); // ex VAT

  // Gross from line items (original)
  const lineSumOriginal = sumLinesEx(lines);

  // Derive base gross/net ex VAT
  let grossExBase: number;
  let netExBase: number;
  if (origSubtotal && approxEq(origSubtotal, lineSumOriginal)) {
    netExBase = Math.max(0, origSubtotal);
    grossExBase = Math.max(0, netExBase + origDiscounts);
  } else {
    grossExBase = Math.max(0, lineSumOriginal);
    netExBase = Math.max(0, grossExBase - origDiscounts);
  }

  // Monetary refunds aggregated by your sync (ex VAT)
  const aggRefundNet = toNum(o?.refundedNet);

  if (aggRefundNet > 0) {
    const netEx = Math.max(0, netExBase - aggRefundNet);
    const grossEx = Math.max(0, grossExBase - aggRefundNet);
    return { netEx, grossEx, discountsUsed: origDiscounts };
  }

  // Fallback: proportional adjustment by refundedQuantity (exchanges)
  const anyRefundQty = lines.some((li) => Number(li.refundedQuantity ?? 0) > 0);
  if (anyRefundQty && lineSumOriginal > 0) {
    const keptSum = lines.reduce((s, li) => {
      const qty = Number(li.quantity ?? 0) || 0;
      const rqty = Number(li.refundedQuantity ?? 0) || 0;
      const kept = Math.max(0, qty - rqty);
      const unit = li.total != null ? toNum(li.total) / Math.max(1, qty) : toNum(li.price);
      return s + unit * kept;
    }, 0);

    const ratio = Math.max(0, Math.min(1, keptSum / lineSumOriginal));
    const effectiveDiscount = origDiscounts * ratio;

    const grossEx = Math.max(0, keptSum);
    const netEx = Math.max(0, keptSum - effectiveDiscount);
    return { netEx, grossEx, discountsUsed: effectiveDiscount };
  }

  // Default
  return { netEx: netExBase, grossEx: grossExBase, discountsUsed: origDiscounts };
}

/* ----------------- route ----------------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr   = searchParams.get("to");
    const from = parseDay(fromStr);
    const to   = parseDay(toStr);
    if (!from || !to) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    const gte = startOfDayUTC(from);
    const lte = endOfDayUTC(to);

    /* =============== SECTION 1: Sales / Profit / Margin% + AOVs =============== */
    let currency = "GBP";
    let salesEx = 0;
    let profit = 0;
    let ordersCount = 0;
    let activeCustomers = 0;
    const activeCustomerSet = new Set<string>();

    // Pull orders in range
    const orders = await prisma.order.findMany({
      where: { processedAt: { gte, lte } },
      select: {
        id: true,
        processedAt: true,
        currency: true,

        // originals
        subtotal: true,        // ex VAT AFTER discounts
        discounts: true,       // ex VAT
        taxes: true,           // VAT

        // refunds (aggregated ex VAT)
        refundedNet: true,
        refundedTax: true,

        customerId: true,

        // include refundedQuantity to adjust cost on exchanges
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

    if (orders.length) {
      currency = orders[0]?.currency || currency;

      // Costs map
      const allVariantIds = Array.from(
        new Set(
          orders.flatMap((o) =>
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
            console.error("[company-overview] fetchVariantUnitCosts failed:", e);
          }
        }
      }

      for (const o of orders) {
        const { netEx } = liveNetExFromOrder(o as any, o.lineItems);

        if (netEx > 0.0001) {
          ordersCount++;
          if (o.customerId) activeCustomerSet.add(o.customerId);
        }

        // Cost on kept quantity only
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

      activeCustomers = activeCustomerSet.size;
    }

    const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;
    const avgOrderValueExVat = ordersCount > 0 ? salesEx / ordersCount : 0;
    const totalCustomers = await prisma.customer.count();
    const avgRevenuePerActiveCustomer = activeCustomers > 0 ? salesEx / activeCustomers : 0;
    const activeRate = totalCustomers > 0 ? (activeCustomers / totalCustomers) * 100 : 0;

    /* =============== SECTION 2: New customers & First-order AOV =============== */
    // Customers created within the range
    const newCustomersCreated = await prisma.customer.count({
      where: { createdAt: { gte, lte } },
    });

    // Determine customers whose FIRST-EVER order falls within [from, to]
    let newCustomersFirstOrderCount = 0;
    let newCustomersFirstOrderAovSum = 0;

    if (orders.length) {
      const custIds = Array.from(new Set(orders.map((o) => String(o.customerId || "")).filter(Boolean)));

      if (custIds.length) {
        // Earliest order date per customer (only for customers seen in range to keep it tight)
        const mins = await prisma.order.groupBy({
          by: ["customerId"],
          where: { customerId: { in: custIds } },
          _min: { processedAt: true },
        });

        // Build a lookup: cid -> earliest date
        const firstByCustomer = new Map<string, Date>();
        for (const row of mins) {
          if (!row.customerId || !row._min?.processedAt) continue;
          firstByCustomer.set(row.customerId, row._min.processedAt);
        }

        // For each customer whose earliest falls within range, find that earliest order and compute netEx
        const firstCids = Array.from(firstByCustomer.entries())
          .filter(([, d]) => d >= gte && d <= lte)
          .map(([cid]) => cid);

        if (firstCids.length) {
          // Fetch the first order per customer (ordered asc, take first)
          const firstOrders = await prisma.order.findMany({
            where: { customerId: { in: firstCids } },
            select: {
              id: true,
              customerId: true,
              processedAt: true,
              subtotal: true,
              discounts: true,
              refundedNet: true,
              lineItems: {
                select: { variantId: true, quantity: true, refundedQuantity: true, price: true, total: true },
              },
            },
            orderBy: [{ customerId: "asc" }, { processedAt: "asc" }, { id: "asc" }],
          });

          // Take the first by customerId
          const seen = new Set<string>();
          for (const o of firstOrders) {
            const cid = String(o.customerId || "");
            if (!cid || seen.has(cid)) continue;
            seen.add(cid);

            const { netEx } = liveNetExFromOrder(o as any, o.lineItems);
            // Exclude zero-value "sample" orders from this average
            if (netEx > 0.0001) {
              newCustomersFirstOrderCount++;
              newCustomersFirstOrderAovSum += netEx;
            }
          }
        }
      }
    }

    const firstOrderAovExVat =
      newCustomersFirstOrderCount > 0 ? newCustomersFirstOrderAovSum / newCustomersFirstOrderCount : 0;

    /* =============== SECTION 3: Forecast / Outlook (simple run-rate) =============== */
    const today = new Date();
    const clampedEnd = lte < today ? lte : today;
    const totalDays = Math.max(1, Math.round((lte.getTime() - gte.getTime()) / 86400000) + 1);
    const elapsedDays = clampedEnd >= gte ? Math.max(1, Math.round((clampedEnd.getTime() - gte.getTime()) / 86400000) + 1) : 1;
    const runRatePerDay = elapsedDays > 0 ? salesEx / elapsedDays : 0;
    const projectedSalesEx = lte > today ? runRatePerDay * totalDays : salesEx;
    const projectedProfit = projectedSalesEx * (marginPct / 100);

    return NextResponse.json(
      {
        ok: true,
        range: { from: fromStr, to: toStr },
        currency,
        section1: {
          salesEx,
          profit,
          marginPct,
          ordersCount,
          avgOrderValueExVat,
          activeCustomers,
          totalCustomers,
          activeRate, // %
          avgRevenuePerActiveCustomer,
        },
        section2: {
          newCustomersCreated,
          newCustomersFirstOrderCount,
          firstOrderAovExVat,
        },
        section3: {
          periodDays: totalDays,
          elapsedDays,
          runRatePerDay,
          projectedSalesEx,
          projectedProfit,
        },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err: any) {
    console.error("company-overview error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
