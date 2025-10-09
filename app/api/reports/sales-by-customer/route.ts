// app/api/reports/sales-by-customer/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantUnitCosts, fetchVariantIdsBySkus } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ----------------------------- Types ----------------------------- */
type Row = {
  customerId: string | null;
  customerName: string;
  orders: number;

  grossEx: number;      // ex VAT, before discounts (current, after returns/exchanges)
  grossInc: number;     // inc VAT (current)
  discounts: number;    // ex VAT (current, pro-rated to kept qty)
  discount: number;     // alias for UI
  netEx: number;        // ex VAT, after discounts (current)

  gross: number;        // = grossInc (UI alias)
  net: number;          // = netEx   (UI alias)

  cost: number;         // sum(keptQty * unitCost)
  margin: number;       // netEx - cost
  marginPct: number | null;
  currency: string;
};

/* --------------------------- Utilities --------------------------- */
const toNum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

/** Sum of line totals as a fallback for original gross ex-VAT. */
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

/* For unit-cost responses that may be Map or plain object */
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

/* =============================== Route =============================== */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const repId = (searchParams.get("repId") || "").trim() || null;
    const repNameParam =
      (searchParams.get("repName") || searchParams.get("staff") || "").trim() || null;

    const fromRaw = searchParams.get("from");
    const toRaw   = searchParams.get("to");
    if (!fromRaw || !toRaw) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    const from = startOfDay(new Date(fromRaw));
    const to   = endOfDay(new Date(toRaw));
    if (isNaN(+from) || isNaN(+to)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    // Resolve canonical rep name when an id is provided (keeps legacy staff filters working)
    let repNameForFilter: string | null = repNameParam;
    if (repId) {
      const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
      repNameForFilter = rep?.name || repNameForFilter;
    }

    /* 1) Pull orders in range with line items & refund fields */
    const orders = await prisma.order.findMany({
      where: { processedAt: { gte: from, lte: to } },
      select: {
        id: true,
        processedAt: true,
        currency: true,

        customerId: true,
        shopifyCustomerId: true,

        // ORIGINAL order-level amounts (typically original totals)
        subtotal: true,      // ex VAT after discounts
        discounts: true,     // ex VAT
        taxes: true,         // VAT
        shipping: true,      // ignored for revenue

        // REFUND aggregates from your sync (may be 0 for exchanges w/ no cash refund)
        refundedNet: true,   // ex VAT after discounts
        refundedTax: true,
        refundedShipping: true,
        refundedTotal: true,

        customer: {
          select: {
            id: true,
            salonName: true,
            customerName: true,
            salesRepId: true,
            salesRep: true, // legacy free-text
            shopifyCustomerId: true,
          },
        },
        lineItems: {
          // refundedQuantity is vital for exchanges/returns
          select: {
            id: true,
            variantId: true,
            sku: true,
            quantity: true,
            refundedQuantity: true,
            price: true,   // ex VAT unit price
            total: true,   // ex VAT line total (often price*qty minus line-level discount)
          },
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

    /* 2) Link unlinked orders via shopifyCustomerId */
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
                  id: true, salonName: true, customerName: true,
                  salesRepId: true, salesRep: true, shopifyCustomerId: true,
                },
              })
            ).map(c => [String(c.shopifyCustomerId ?? ""), c])
          )
        : new Map<string, any>();

    /* 3) Rep filter (canonical id OR legacy name), using linked or orphan customer */
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

    /* 4) Collect variantIds & backfill missing by SKU (cap) */
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
        console.error("[sales-by-customer] variantId backfill by SKU failed:", e);
      }
    }

    /* 5) Pull/Backfill unit costs */
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
          console.error("[sales-by-customer] variant cost backfill failed:", e);
        }
      }
    }

    /* 6) Aggregate by customer using KEPT QTY (fixes exchanges) */
    const rowsMap = new Map<string, Row>();
    const currency = filteredOrders.find(o => o.currency)?.currency || "GBP";

    for (const o of filteredOrders) {
      const cust = o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);
      const customerId = cust?.id ?? null;
      const name = (cust?.salonName || cust?.customerName || "Unlinked customer").trim();
      const key = customerId || `unlinked:${name}`;

      const taxesOriginal = toNum(o.taxes);
      const subtotalOriginal = toNum(o.subtotal);   // ex VAT after discounts (original)
      let discountsOriginal = toNum(o.discounts);   // ex VAT (original)

      // If discounts field is missing/0 but lines imply discount, infer it
      if (!discountsOriginal) {
        const lineGross = grossFromLines(o.lineItems);
        const inferred = Math.max(0, lineGross - subtotalOriginal);
        discountsOriginal = inferred > 0 ? inferred : 0;
      }

      // Build original and kept gross ex-VAT from line items
      let grossExOriginal = 0;
      let grossExKept = 0;

      for (const li of o.lineItems) {
        const qty = Number(li.quantity ?? 0) || 0;
        const refundedQty = Number(li.refundedQuantity ?? 0) || 0;
        const kept = Math.max(0, qty - refundedQty);

        // Derive unit gross ex VAT
        const unitGrossEx =
          qty > 0 && li.total != null ? toNum(li.total) / qty : toNum(li.price);

        grossExOriginal += unitGrossEx * qty;
        grossExKept     += unitGrossEx * kept;
      }

      // Pro-rate discounts & VAT to kept portion when possible
      const keepRatio = grossExOriginal > 0 ? grossExKept / grossExOriginal : 0;
      const discountsKept = discountsOriginal * keepRatio;
      const taxKept       = taxesOriginal * keepRatio;

      // Current ex-VAT and inc-VAT revenue from kept quantities
      let netEx   = Math.max(0, grossExKept - discountsKept);
      let grossEx = grossExKept;                      // for reporting ex VAT
      let grossInc = Math.max(0, grossExKept + taxKept);

      // Fallback: if we couldn't compute from lines, use order-level refund fields
      if (grossExOriginal === 0) {
        const refNet = toNum(o.refundedNet);
        const refTax = toNum(o.refundedTax);
        // Original: subtotal (ex VAT after discounts) and taxes
        const fallbackNetEx = Math.max(0, subtotalOriginal - refNet);
        const fallbackGrossInc = Math.max(0, (subtotalOriginal + taxesOriginal) - (refNet + refTax));

        netEx   = fallbackNetEx;
        grossEx = Math.max(0, netEx + (discountsOriginal - refNet)); // rough ex-VAT gross fallback
        grossInc = fallbackGrossInc;
      }

      // Cost = unitCost * kept qty
      let cost = 0;
      for (const li of o.lineItems) {
        const qty = Number(li.quantity ?? 0) || 0;
        const refundedQty = Number(li.refundedQuantity ?? 0) || 0;
        const kept = Math.max(0, qty - refundedQty);
        const unit = costMap.get(String(li.variantId || ""));
        if (unit != null) cost += unit * kept;
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
          discounts: discountsKept,
          discount: discountsKept,
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
        prev.discounts += discountsKept;
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
