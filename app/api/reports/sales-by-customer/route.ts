// app/api/reports/sales-by-customer/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantUnitCosts, fetchVariantIdsBySkus } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  customerId: string | null;
  customerName: string;
  orders: number;

  grossEx: number;      // ex VAT, before discounts (effective, after returns)
  grossInc: number;     // inc VAT = grossEx + taxes (effective, after returns)
  discounts: number;    // Shopify total_discounts (ex VAT) (best available)
  discount: number;     // alias for UI
  netEx: number;        // ex VAT, after discounts (effective, after returns)

  gross: number;        // = grossInc (UI alias)
  net: number;          // = netEx   (UI alias)

  cost: number;         // sum(qtyEffective * unitCost)
  margin: number;       // netEx - cost
  marginPct: number | null;
  currency: string;
};

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

/** Sum of line amounts (tries `total` first; otherwise price*qty). Intended as ex-VAT. */
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

/** Small epsilon compare for deciding if subtotal ~= sum(lines). */
const approxEq = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

/**
 * Compute *effective* revenue numbers for an order using the best available data:
 * - Prefers "current" Shopify fields if your sync saves them, else uses original fields.
 * - Falls back to line totals + discounts when needed.
 * - Subtracts refunds/returns via aggregated columns AND, if present, the nested `refunds` objects.
 *
 * Returns: { netEx, grossEx, grossInc, discountsUsed }
 */
function liveRevenueFromOrder(
  o: any, // order record
  lines: { total: any | null; price: any | null; quantity: number | null }[]
): { netEx: number; grossEx: number; grossInc: number; discountsUsed: number } {
  // Prefer current fields if present (no compile/runtime risk since we read via `any`)
  const curSubtotal = toNum(o?.currentSubtotal ?? o?.currentSubtotalExVat);
  const curDiscounts = toNum(o?.currentDiscounts ?? o?.currentTotalDiscounts);
  const curTaxes     = toNum(o?.currentTaxes);

  const origSubtotal = toNum(o?.subtotal);  // ex VAT AFTER discounts (original capture)
  const origDiscounts= toNum(o?.discounts); // ex VAT
  const origTaxes    = toNum(o?.taxes);     // VAT

  const lineSum = sumLinesEx(lines);

  // Decide base subtotal/discounts/taxes set
  const baseSubtotal = curSubtotal || origSubtotal || 0;
  const baseDiscounts = (curDiscounts || origDiscounts || 0);
  const baseTaxes = (curTaxes || origTaxes || 0);

  // If subtotal ≈ sum(lines), treat lineSum as already net ex-VAT (post-discount).
  // Otherwise treat lineSum as gross ex-VAT and subtract discounts.
  let netExBase: number;
  let grossExBase: number;
  if (baseSubtotal && approxEq(baseSubtotal, lineSum)) {
    netExBase = Math.max(0, baseSubtotal);
    grossExBase = Math.max(0, netExBase + baseDiscounts);
  } else {
    // Assume `lineSum` represents gross ex-VAT (before discounts)
    grossExBase = Math.max(0, lineSum);
    netExBase = Math.max(0, grossExBase - baseDiscounts);
  }

  // Aggregated refunds captured by your webhook/sync
  const aggRefundNet = toNum(o?.refundedNet);  // ex VAT
  const aggRefundTax = toNum(o?.refundedTax);  // VAT

  // Detailed Shopify refunds (if synced)
  let detRefundNet = 0;
  let detRefundTax = 0;
  const refunds = o?.refunds || o?.Refunds;
  if (Array.isArray(refunds)) {
    for (const rf of refunds) {
      const items = rf?.refundLineItems || rf?.refund_line_items;
      if (Array.isArray(items)) {
        for (const it of items) {
          // Shopify: refund_line_item.subtotal_set.shop_money.amount (ex VAT)
          const subEx =
            toNum(it?.subtotal) ||
            toNum(it?.subtotal_set?.shop_money?.amount);
          detRefundNet += subEx;
        }
      }
      const adjs = rf?.orderAdjustments || rf?.order_adjustments;
      if (Array.isArray(adjs)) {
        for (const adj of adjs) detRefundNet += toNum(adj?.amount);
      }
      const taxAmt =
        toNum(rf?.total_tax_set?.shop_money?.amount) ||
        toNum(rf?.totalTax);
      detRefundTax += taxAmt;
    }
  }

  const totalRefundNet = aggRefundNet + detRefundNet;
  const totalRefundTax = aggRefundTax + detRefundTax;

  const netEx   = Math.max(0, netExBase   - totalRefundNet);
  const grossEx = Math.max(0, grossExBase - totalRefundNet);
  const grossInc= Math.max(0, grossEx + Math.max(0, baseTaxes - totalRefundTax));

  return { netEx, grossEx, grossInc, discountsUsed: baseDiscounts };
}

type CostEntry = { unitCost: number | string; currency?: string };
function normalizeCostMap(input: any): Map<string, CostEntry> {
  if (input && typeof input === "object" && typeof (input as Map<any, any>).entries === "function") {
    return input as Map<string, CostEntry>;
  }
  const m = new Map<string, CostEntry>();
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      if (v && typeof v === "object" && "unitCost" in (v as any)) {
        m.set(k, v as CostEntry);
      } else if (typeof v === "number" || typeof v === "string") {
        m.set(k, { unitCost: v as number | string });
      }
    }
  }
  return m;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const repId = (searchParams.get("repId") || "").trim() || null;
    const repNameParam = (searchParams.get("repName") || searchParams.get("staff") || "").trim() || null;

    const fromRaw = searchParams.get("from");
    const toRaw = searchParams.get("to");
    if (!fromRaw || !toRaw) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    const from = startOfDay(new Date(fromRaw));
    const to = endOfDay(new Date(toRaw));
    if (isNaN(+from) || isNaN(+to)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    // Rep display name (if id given)
    let repNameForFilter: string | null = repNameParam;
    if (repId) {
      const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
      repNameForFilter = rep?.name || repNameForFilter;
    }

    // 1) Orders in range
    const orders = await prisma.order.findMany({
      where: { processedAt: { gte: from, lte: to } },
      select: {
        id: true,
        processedAt: true,
        currency: true,

        // order linkage
        customerId: true,
        shopifyCustomerId: true,

        // revenue components (originals)
        subtotal: true,         // ex VAT AFTER discount
        discounts: true,        // ex VAT
        taxes: true,            // VAT
        shipping: true,         // ignored in revenue

        // refunds (aggregated via webhook)
        refundedNet: true,      // ex VAT after discounts
        refundedTax: true,
        refundedShipping: true, // ignored in revenue
        refundedTotal: true,    // inc VAT (not used directly)

        // If your sync stores Shopify "refunds" objects, they will be present in `o as any`
        // and read dynamically by liveRevenueFromOrder (no need to select explicitly here).

        customer: {
          select: {
            id: true,
            salonName: true,
            customerName: true,
            salesRepId: true,
            salesRep: true, // legacy text
            shopifyCustomerId: true,
          },
        },
        lineItems: {
          // include refundedQuantity for cost adjustment + sku for backfill
          select: { id: true, variantId: true, sku: true, quantity: true, refundedQuantity: true, price: true, total: true },
        },
      },
      orderBy: { processedAt: "asc" },
    });

    if (!orders.length) {
      return NextResponse.json({
        rows: [],
        total: { gross: 0, grossInc: 0, grossEx: 0, discounts: 0, net: 0, netEx: 0, cost: 0, margin: 0 },
        currency: "GBP",
      });
    }

    // 2) Link unlinked orders by shopifyCustomerId
    const orphanShopIds = Array.from(
      new Set(orders.filter(o => !o.customerId && o.shopifyCustomerId).map(o => String(o.shopifyCustomerId)))
    );
    const orphanMap =
      orphanShopIds.length
        ? new Map(
            (
              await prisma.customer.findMany({
                where: { shopifyCustomerId: { in: orphanShopIds } },
                select: {
                  id: true,
                  salonName: true,
                  customerName: true,
                  salesRepId: true,
                  salesRep: true,
                  shopifyCustomerId: true,
                },
              })
            ).map(c => [String(c.shopifyCustomerId ?? ""), c])
          )
        : new Map<string, any>();

    // 3) Rep filter (by canonical id OR legacy name)
    const filteredOrders = orders.filter((o) => {
      const c = o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);
      if (!repId && !repNameForFilter) return true;
      if (!c) return false;
      const idMatch = repId && c.salesRepId ? c.salesRepId === repId : false;
      const nameMatch =
        repNameForFilter && c.salesRep
          ? (c.salesRep || "").trim().toLowerCase() === repNameForFilter.trim().toLowerCase()
          : false;
      return Boolean(idMatch || nameMatch);
    });

    if (!filteredOrders.length) {
      return NextResponse.json({
        rows: [],
        total: { gross: 0, grossInc: 0, grossEx: 0, discounts: 0, net: 0, netEx: 0, cost: 0, margin: 0 },
        currency: orders[0]?.currency || "GBP",
      });
    }

    // 4) Collect variantIds; detect lines missing variantId but having SKU (to backfill)
    const allVariantIds = new Set<string>();
    const linesMissingVariant: { id: string; sku: string }[] = [];

    for (const o of filteredOrders) {
      for (const li of o.lineItems) {
        const vId = (li.variantId ? `${li.variantId}` : "").trim();
        if (vId) {
          allVariantIds.add(vId);
        } else if ((li.sku || "").trim()) {
          linesMissingVariant.push({ id: li.id, sku: (li.sku || "").trim() });
        }
      }
    }

    // 4a) Backfill missing variantIds by SKU (cap)
    if (linesMissingVariant.length) {
      const BACKFILL_SKU_LIMIT = 100;
      const uniqueSkus = Array.from(new Set(linesMissingVariant.map(x => x.sku))).slice(0, BACKFILL_SKU_LIMIT);

      try {
        const skuToVariant = await fetchVariantIdsBySkus(uniqueSkus); // Map<sku, variantId>
        const toUpdate: Array<{ id: string; variantId: string }> = [];
        for (const rec of linesMissingVariant) {
          const vId = skuToVariant.get(rec.sku);
          if (vId) {
            toUpdate.push({ id: rec.id, variantId: vId });
            allVariantIds.add(vId);
          }
        }
        for (const u of toUpdate) {
          await prisma.orderLineItem.update({ where: { id: u.id }, data: { variantId: u.variantId } });
        }
      } catch (e) {
        console.error("[report] variantId backfill by SKU failed:", e);
      }
    }

    // 4b) Pull cached unit costs
    const costMap = new Map<string, number>();
    if (allVariantIds.size) {
      const costs = await prisma.shopifyVariantCost.findMany({
        where: { variantId: { in: Array.from(allVariantIds) } },
        select: { variantId: true, unitCost: true },
      });
      for (const c of costs) {
        const key = `${c.variantId}`;
        if (!costMap.has(key)) costMap.set(key, toNum(c.unitCost));
      }
    }

    // 4c) Backfill missing costs from Shopify and cache
    const missingVariantIds = Array.from(allVariantIds).filter(id => !costMap.has(id));
    if (missingVariantIds.length) {
      const BACKFILL_COST_LIMIT = 200;
      const toFetch = missingVariantIds.slice(0, BACKFILL_COST_LIMIT);
      try {
        const fetchedRaw = await fetchVariantUnitCosts(toFetch);
        const fetched = normalizeCostMap(fetchedRaw);
        for (const [variantId, entry] of fetched.entries()) {
          const unitCostNum = Number(entry.unitCost);
          if (!Number.isFinite(unitCostNum)) continue;
          await prisma.shopifyVariantCost.upsert({
            where: { variantId },
            create: { variantId, unitCost: unitCostNum, currency: entry.currency || "GBP" },
            update: { unitCost: unitCostNum, currency: entry.currency || "GBP" },
          });
          costMap.set(variantId, unitCostNum);
        }
      } catch (e) {
        console.error("[report] variant cost backfill failed:", e);
      }
    }

    // 5) Aggregate by customer (live net/gross; adjust cost for refunded qty)
    const rowsMap = new Map<string, Row>();
    const currency = filteredOrders.find(o => o.currency)?.currency || "GBP";

    for (const o of filteredOrders) {
      const cust = o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);
      const customerId = cust?.id ?? null;
      const name = (cust?.salonName || cust?.customerName || "Unlinked customer").trim();
      const key = customerId || `unlinked:${name}`;

      // LIVE revenue (handles exchanges/refunds)
      const { netEx, grossEx, grossInc, discountsUsed } = liveRevenueFromOrder(o as any, o.lineItems);

      // cost = sum(unitCost * (qty - refundedQty))
      let cost = 0;
      for (const li of o.lineItems) {
        const vId = (li.variantId ? `${li.variantId}` : "").trim();
        if (!vId) continue;
        const unitCost = costMap.get(vId);
        if (unitCost == null) continue;
        const qty = Number(li.quantity ?? 0) || 0;
        const refundedQty = Number(li.refundedQuantity ?? 0) || 0;
        const effectiveQty = Math.max(0, qty - refundedQty);
        cost += unitCost * effectiveQty;
      }

      const prev = rowsMap.get(key);
      if (!prev) {
        const margin = Math.max(0, netEx - cost);
        rowsMap.set(key, {
          customerId,
          customerName: name,
          orders: 1,

          grossEx,
          grossInc,
          discounts: discountsUsed,
          discount: discountsUsed,
          netEx,

          gross: grossInc,
          net: netEx,

          cost,
          margin,
          marginPct: netEx > 0 ? (margin / netEx) * 100 : null,
          currency,
        });
      } else {
        prev.orders += 1;

        prev.grossEx += grossEx;
        prev.grossInc += grossInc;
        prev.discounts += discountsUsed;
        prev.discount = prev.discounts;
        prev.netEx += netEx;

        prev.gross = prev.grossInc;
        prev.net = prev.netEx;

        prev.cost += cost;
        prev.margin = Math.max(0, prev.netEx - prev.cost);
        prev.marginPct = prev.netEx > 0 ? (prev.margin / prev.netEx) * 100 : null;
      }
    }

    const rows = Array.from(rowsMap.values()).sort((a, b) => b.netEx - a.netEx);

    const totals = rows.reduce(
      (acc, r) => {
        acc.grossEx += r.grossEx;
        acc.grossInc += r.grossInc;
        acc.discounts += r.discounts;
        acc.netEx += r.netEx;
        acc.cost += r.cost;
        acc.margin += r.margin;
        return acc;
      },
      { grossEx: 0, grossInc: 0, discounts: 0, netEx: 0, cost: 0, margin: 0 }
    );

    const totalWithAliases = {
      ...totals,
      gross: totals.grossInc,
      net: totals.netEx,
      discount: totals.discounts,
    };

    return NextResponse.json({
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      currency,
      rows,
      total: totalWithAliases,
    });
  } catch (err: any) {
    console.error("sales-by-customer error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
