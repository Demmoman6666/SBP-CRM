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

/** Compute effective ex-VAT revenue for an order after returns/exchanges. */
function liveNetExFromOrder(
  o: any,
  lines: { price: any | null; total: any | null; quantity: number | null; refundedQuantity?: number | null }[]
): { netEx: number; grossEx: number; discountsUsed: number } {
  const origSubtotal = toNum(o?.subtotal);   // ex VAT AFTER discounts
  const origDiscounts = toNum(o?.discounts); // ex VAT
  const lineSumOriginal = sumLinesEx(lines);

  let grossExBase: number;
  let netExBase: number;
  if (origSubtotal && approxEq(origSubtotal, lineSumOriginal)) {
    netExBase = Math.max(0, origSubtotal);
    grossExBase = Math.max(0, netExBase + origDiscounts);
  } else {
    grossExBase = Math.max(0, lineSumOriginal);
    netExBase = Math.max(0, grossExBase - origDiscounts);
  }

  const aggRefundNet = toNum(o?.refundedNet);
  if (aggRefundNet > 0) {
    const netEx = Math.max(0, netExBase - aggRefundNet);
    const grossEx = Math.max(0, grossExBase - aggRefundNet);
    return { netEx, grossEx, discountsUsed: origDiscounts };
  }

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

  return { netEx: netExBase, grossEx: grossExBase, discountsUsed: origDiscounts };
}

/* ----------------- helpers: rep attribution ----------------- */
type RepInfo = { repId: string | null; repName: string; key: string };
const UNASSIGNED_KEY = "__unassigned__";
function repFromCustomer(c?: { salesRepId: string | null; salesRep: string | null; rep?: { id: string; name: string | null } | null }): RepInfo {
  const id = c?.salesRepId ?? c?.rep?.id ?? null;
  const name = (c?.rep?.name ?? c?.salesRep ?? "").trim();
  if (id || name) {
    return { repId: id, repName: name || "(Unnamed rep)", key: id ?? name.toLowerCase() };
  }
  return { repId: null, repName: "Unassigned", key: UNASSIGNED_KEY };
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

    // Per-rep aggregates
    const repAgg = new Map<string, {
      repId: string | null;
      repName: string;
      salesEx: number;
      profit: number;
      ordersCount: number;
      activeCustomers: Set<string>;
    }>();

    const orders = await prisma.order.findMany({
      where: { processedAt: { gte, lte } },
      select: {
        id: true,
        processedAt: true,
        currency: true,
        subtotal: true,
        discounts: true,
        taxes: true,
        refundedNet: true,
        refundedTax: true,
        customerId: true,
        customer: {
          select: {
            salesRepId: true,
            salesRep: true,
            rep: { select: { id: true, name: true } },
          },
        },
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
        const orderProfit = Math.max(0, netEx - cost);

        // Overall
        salesEx += netEx;
        profit  += orderProfit;
        if (netEx > 0.0001) {
          ordersCount++;
          if (o.customerId) activeCustomerSet.add(o.customerId);
        }

        // Per-rep
        const r = repFromCustomer(o.customer || undefined);
        const bucket = repAgg.get(r.key) ?? {
          repId: r.repId,
          repName: r.repName,
          salesEx: 0,
          profit: 0,
          ordersCount: 0,
          activeCustomers: new Set<string>(),
        };
        bucket.salesEx += netEx;
        bucket.profit  += orderProfit;
        if (netEx > 0.0001) {
          bucket.ordersCount += 1;
          if (o.customerId) bucket.activeCustomers.add(o.customerId);
        }
        repAgg.set(r.key, bucket);
      }

      activeCustomers = activeCustomerSet.size;
    }

    const marginPct = salesEx > 0 ? (profit / salesEx) * 100 : 0;
    const avgOrderValueExVat = ordersCount > 0 ? salesEx / ordersCount : 0;
    const totalCustomers = await prisma.customer.count();
    const avgRevenuePerActiveCustomer = activeCustomers > 0 ? salesEx / activeCustomers : 0;
    const activeRate = totalCustomers > 0 ? (activeCustomers / totalCustomers) * 100 : 0;

    /* Produce per-rep rows + assigned/unassigned totals */
    const revenueByRep = Array.from(repAgg.values())
      .map((b) => ({
        repId: b.repId,
        repName: b.repName,
        salesEx: b.salesEx,
        profit: b.profit,
        marginPct: b.salesEx > 0 ? (b.profit / b.salesEx) * 100 : 0,
        ordersCount: b.ordersCount,
        activeCustomers: b.activeCustomers.size,
      }))
      .sort((a, b) => b.salesEx - a.salesEx);

    const assigned = revenueByRep.filter(r => r.repId !== null && r.repName !== "Unassigned");
    const unassigned = revenueByRep.filter(r => r.repId === null || r.repName === "Unassigned");
    const assignedSalesEx = assigned.reduce((s, r) => s + r.salesEx, 0);
    const assignedProfit  = assigned.reduce((s, r) => s + r.profit, 0);
    const unassignedSalesEx = unassigned.reduce((s, r) => s + r.salesEx, 0);
    const unassignedProfit  = unassigned.reduce((s, r) => s + r.profit, 0);

    /* =============== SECTION 2: New customers & First-order AOV (overall) =============== */
    const newCustomersCreated = await prisma.customer.count({
      where: { createdAt: { gte, lte } },
    });

    // First-ever order cohort inside the window
    let newCustomersFirstOrderCount = 0;
    let newCustomersFirstOrderAovSum = 0;

    // For per-rep attribution later
    const firstOrderCountByRep = new Map<string, { repId: string | null; repName: string; cnt: number; sum: number }>();

    if (orders.length) {
      const custIds = Array.from(new Set(orders.map((o) => String(o.customerId || "")).filter(Boolean)));
      if (custIds.length) {
        const mins = await prisma.order.groupBy({
          by: ["customerId"],
          where: { customerId: { in: custIds } },
          _min: { processedAt: true },
        });

        const firstByCustomer = new Map<string, Date>();
        for (const row of mins) {
          if (!row.customerId || !row._min?.processedAt) continue;
          firstByCustomer.set(row.customerId, row._min.processedAt);
        }

        const firstCids = Array.from(firstByCustomer.entries())
          .filter(([, d]) => d >= gte && d <= lte)
          .map(([cid]) => cid);

        if (firstCids.length) {
          // rep info for those customers
          const firstCusts = await prisma.customer.findMany({
            where: { id: { in: firstCids } },
            select: {
              id: true,
              salesRepId: true,
              salesRep: true,
              rep: { select: { id: true, name: true } },
            },
          });
          const firstCustRep = new Map<string, RepInfo>();
          for (const c of firstCusts) firstCustRep.set(c.id, repFromCustomer(c as any));

          const firstOrders = await prisma.order.findMany({
            where: { customerId: { in: firstCids } },
            select: {
              id: true,
              customerId: true,
              processedAt: true,
              subtotal: true,
              discounts: true,
              refundedNet: true,
              lineItems: { select: { variantId: true, quantity: true, refundedQuantity: true, price: true, total: true } },
            },
            orderBy: [{ customerId: "asc" }, { processedAt: "asc" }, { id: "asc" }],
          });

          const seen = new Set<string>();
          for (const o of firstOrders) {
            const cid = String(o.customerId || "");
            if (!cid || seen.has(cid)) continue;
            seen.add(cid);

            const { netEx } = liveNetExFromOrder(o as any, o.lineItems);
            if (netEx > 0.0001) {
              newCustomersFirstOrderCount++;
              newCustomersFirstOrderAovSum += netEx;

              const r = firstCustRep.get(cid) ?? { repId: null, repName: "Unassigned", key: UNASSIGNED_KEY };
              const row = firstOrderCountByRep.get(r.key) ?? { repId: r.repId, repName: r.repName, cnt: 0, sum: 0 };
              row.cnt += 1;
              row.sum += netEx;
              firstOrderCountByRep.set(r.key, row);
            }
          }
        }
      }
    }

    const firstOrderAovExVat =
      newCustomersFirstOrderCount > 0 ? newCustomersFirstOrderAovSum / newCustomersFirstOrderCount : 0;

    /* =============== SECTION 2b: New customers who have NOT ordered (drop-offs) =============== */
    let newCustomersNoOrder = 0;
    const newNoOrderByRep = new Map<string, { repId: string | null; repName: string; count: number }>();
    const newCreatedList = await prisma.customer.findMany({
      where: { createdAt: { gte, lte } },
      select: {
        id: true,
        salesRepId: true,
        salesRep: true,
        rep: { select: { id: true, name: true } },
      },
    });
    if (newCreatedList.length) {
      const newIds = newCreatedList.map(c => c.id);
      const ordersByNew = await prisma.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: newIds }, processedAt: { lte } },
        _count: { _all: true },
      });
      const hasOrderSet = new Set(ordersByNew.filter(r => (r._count?._all ?? 0) > 0).map(r => String(r.customerId)));

      for (const c of newCreatedList) {
        if (!hasOrderSet.has(c.id)) {
          newCustomersNoOrder += 1;
          const r = repFromCustomer(c as any);
          const entry = newNoOrderByRep.get(r.key) ?? { repId: r.repId, repName: r.repName, count: 0 };
          entry.count += 1;
          newNoOrderByRep.set(r.key, entry);
        }
      }
    }

    /* =============== SECTION 3: Forecast / Outlook (run-rate + acquisition-driven) =============== */
    const today = new Date();
    const clampedEnd = lte < today ? lte : today;
    const totalDays = Math.max(1, Math.round((lte.getTime() - gte.getTime()) / 86400000) + 1);
    const elapsedDays = clampedEnd >= gte ? Math.max(1, Math.round((clampedEnd.getTime() - gte.getTime()) / 86400000) + 1) : 1;
    const remainingDays = Math.max(0, totalDays - elapsedDays);

    const runRatePerDay = elapsedDays > 0 ? salesEx / elapsedDays : 0;
    const projectedSalesEx = lte > today ? runRatePerDay * totalDays : salesEx;
    const projectedProfit = projectedSalesEx * (marginPct / 100);

    // Acquisition-driven projection by rep: use FIRST-ORDER run-rate ✕ remaining days ✕ first-order AOV
    const revenueByRepMap = new Map<string, { salesEx: number }>();
    for (const r of revenueByRep) revenueByRepMap.set((r.repId ?? r.repName).toString(), { salesEx: r.salesEx });

    // Build lookups for first-order stats by rep
    const newCustomersByRep: Array<{
      repId: string | null;
      repName: string;
      newCustomersCreated: number;
      newCustomersFirstOrderCount: number;
      firstOrderAovExVat: number;
    }> = Array.from(
      new Set([
        ...Array.from(new Map(Array.from(firstOrderCountByRep).map(([key, v]) => [key, v])) .keys()),
        ...Array.from(new Map(newCreatedList.map(c => [repFromCustomer(c as any).key, c])).keys()),
      ])
    ).map((key) => {
      // created per rep
      const created = newCreatedList.filter(c => repFromCustomer(c as any).key === key).length;
      // first-order stats per rep
      const f = firstOrderCountByRep.get(key);
      const repId = f?.repId ?? null;
      const repName = f?.repName ?? (newCreatedList.find(c => repFromCustomer(c as any).key === key) ? repFromCustomer(newCreatedList.find(c => repFromCustomer(c as any).key === key) as any).repName : "Unassigned");
      const firstOrderCount = f?.cnt ?? 0;
      const firstOrderAov = firstOrderCount > 0 ? (f?.sum ?? 0) / firstOrderCount : 0;
      return {
        repId,
        repName,
        newCustomersCreated: created,
        newCustomersFirstOrderCount: firstOrderCount,
        firstOrderAovExVat: firstOrderAov,
      };
    }).sort((a, b) => b.newCustomersFirstOrderCount - a.newCustomersFirstOrderCount);

    const byRepAcquisitionProjection = newCustomersByRep.map((r) => {
      const acqRunRatePerDay = elapsedDays > 0 ? r.newCustomersFirstOrderCount / elapsedDays : 0;
      const projectedNewFirstOrders = acqRunRatePerDay * remainingDays;
      const projectedIncrementalSalesEx = projectedNewFirstOrders * (r.firstOrderAovExVat || 0);
      const key = (r.repId ?? r.repName).toString();
      const currentRepSales = revenueByRepMap.get(key)?.salesEx ?? 0;
      const projectedSalesExTotal = currentRepSales + projectedIncrementalSalesEx;
      return {
        repId: r.repId,
        repName: r.repName,
        acqRunRatePerDay,
        firstOrderAovExVat: r.firstOrderAovExVat || 0,
        remainingDays,
        projectedNewFirstOrders,
        projectedIncrementalSalesEx,
        currentSalesEx: currentRepSales,
        projectedSalesExTotal,
      };
    });

    const projectedIncrementalFromAcquisition =
      byRepAcquisitionProjection.reduce((s, r) => s + r.projectedIncrementalSalesEx, 0);
    const projectedSalesExIfAcquisitionContinues = salesEx + projectedIncrementalFromAcquisition;

    /* =============== SECTION 4: Per-rep attribution: created + first-order + no-order =============== */
    const createdByRepMap = new Map<string, { repId: string | null; repName: string; created: number }>();
    for (const c of newCreatedList) {
      const r = repFromCustomer(c as any);
      const row = createdByRepMap.get(r.key) ?? { repId: r.repId, repName: r.repName, created: 0 };
      row.created += 1;
      createdByRepMap.set(r.key, row);
    }

    const newCustomersByRepCombined = Array.from(
      new Set([
        ...Array.from(createdByRepMap.keys()),
        ...Array.from(firstOrderCountByRep.keys()),
        ...Array.from(newNoOrderByRep.keys()),
      ])
    ).map((key) => {
      const created = createdByRepMap.get(key);
      const first   = firstOrderCountByRep.get(key);
      const noord   = newNoOrderByRep.get(key);
      const repId = created?.repId ?? first?.repId ?? noord?.repId ?? null;
      const repName = created?.repName ?? first?.repName ?? noord?.repName ?? "Unassigned";
      const firstOrderCount = first?.cnt ?? 0;
      const firstOrderAov = firstOrderCount > 0 ? (first?.sum ?? 0) / firstOrderCount : 0;
      return {
        repId,
        repName,
        newCustomersCreated: created?.created ?? 0,
        newCustomersFirstOrderCount: firstOrderCount,
        firstOrderAovExVat: firstOrderAov,
        newCustomersNoOrder: noord?.count ?? 0,
      };
    }).sort((a, b) => b.newCustomersCreated - a.newCustomersCreated);

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
          newCustomersNoOrder, // <-- NEW (company-wide drop-offs)
        },
        section3: {
          periodDays: totalDays,
          elapsedDays,
          remainingDays,
          runRatePerDay,
          projectedSalesEx,
          projectedProfit,
          projectedIncrementalFromAcquisition, // <-- NEW (company-wide)
          projectedSalesExIfAcquisitionContinues, // <-- NEW
          byRepAcquisitionProjection, // <-- NEW (array)
        },
        section4: {
          revenueByRep,
          totals: {
            assignedSalesEx,
            assignedProfit,
            unassignedSalesEx,
            unassignedProfit,
          },
          newCustomersByRep: newCustomersByRepCombined, // includes created, first-order, AOV, no-order
        },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err: any) {
    console.error("company-overview error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
