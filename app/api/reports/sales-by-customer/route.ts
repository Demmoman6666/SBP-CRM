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

  grossEx: number;      // ex VAT, before discounts
  grossInc: number;     // inc VAT = grossEx + taxes
  discounts: number;    // Shopify total_discounts (ex VAT)
  discount: number;     // alias for UI
  netEx: number;        // ex VAT, after discounts

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

/** Fallback: sum of line totals (best-effort), ex VAT. */
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

    // 5) Aggregate by customer (subtract refunds; adjust cost for refunded qty)
    const rowsMap = new Map<string, Row>();
    const currency = filteredOrders.find(o => o.currency)?.currency || "GBP";

    for (const o of filteredOrders) {
      const cust = o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);
      const customerId = cust?.id ?? null;
      const name = (cust?.salonName || cust?.customerName || "Unlinked customer").trim();
      const key = customerId || `unlinked:${name}`;

      // base amounts
      const taxes = toNum(o.taxes);
      const netExOriginal = toNum(o.subtotal);      // ex VAT after discounts
      let discounts = toNum(o.discounts);           // ex VAT
      if (!discounts) {
        const lineGross = grossFromLines(o.lineItems);
        const inferred = Math.max(0, lineGross - netExOriginal);
        discounts = inferred > 0 ? inferred : 0;
      }
      const grossExOriginal = Math.max(0, netExOriginal + discounts);
      const grossIncOriginal = Math.max(0, grossExOriginal + taxes);

      // refunds
      const refundedNet = toNum(o.refundedNet);   // ex VAT after discounts
      const refundedTax = toNum(o.refundedTax);

      // effective revenue after refunds
      const netEx = Math.max(0, netExOriginal - refundedNet);
      const grossEx = Math.max(0, grossExOriginal - refundedNet); // discount already baked in via netEx
      const grossInc = Math.max(0, grossIncOriginal - (refundedNet + refundedTax));

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
          discounts,
          discount: discounts,
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
        prev.discounts += discounts;
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
