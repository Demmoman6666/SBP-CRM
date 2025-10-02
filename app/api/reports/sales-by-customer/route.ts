// app/api/reports/sales-by-customer/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantUnitCosts } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  customerId: string | null;
  customerName: string;
  orders: number;

  // Explicit fields
  grossEx: number;      // ex VAT, before discounts
  grossInc: number;     // inc VAT (ex VAT + taxes), before discounts
  discounts: number;    // from Shopify order.discounts (ex VAT)
  netEx: number;        // ex VAT, after discounts

  // Aliases for UI that renders "Gross (inc VAT), Discounts, Net"
  gross: number;        // = grossInc (what you want to display)
  net: number;          // = netEx

  cost: number;         // sum of qty * unitCost
  margin: number;       // netEx - cost
  marginPct: number | null;
  currency: string;
};

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Sum of line totals (pre-discount), ex VAT. */
function grossFromLines(
  lines: { total: any | null; price: any | null; quantity: number | null }[]
): number {
  let s = 0;
  for (const li of lines) {
    if (li.total != null) {
      s += toNum(li.total);
    } else {
      s += toNum(li.price) * (Number(li.quantity ?? 0) || 0);
    }
  }
  return Math.max(0, s);
}

/** Net ex VAT, after discounts, before shipping. Prefer Order.subtotal (Shopify "subtotal_price"). */
function netExFromOrder(
  o: { subtotal: any | null; discounts: any | null },
  grossEx: number
): number {
  const sub = o.subtotal != null ? toNum(o.subtotal) : NaN;
  if (Number.isFinite(sub)) return Math.max(0, sub);
  const disc = toNum(o.discounts);
  return Math.max(0, grossEx - disc);
}

/** Normalize cost response to a Map<string, { unitCost, currency? }>. */
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

    // Resolve rep name if an id was provided (for legacy name fallback filters)
    let repNameForFilter: string | null = repNameParam;
    if (repId) {
      const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
      repNameForFilter = rep?.name || repNameForFilter;
    }

    // 1) Orders in range with line items & lightweight customer
    const orders = await prisma.order.findMany({
      where: { processedAt: { gte: from, lte: to } },
      select: {
        id: true,
        processedAt: true,
        currency: true,
        customerId: true,
        shopifyCustomerId: true,
        subtotal: true,   // ex VAT, after discounts
        discounts: true,  // Shopify's total_discounts (ex VAT)
        taxes: true,      // VAT amount charged (after discounts)
        shipping: true,   // exclude from revenue
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
          select: { variantId: true, quantity: true, price: true, total: true },
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
      new Set(
        orders
          .filter((o) => !o.customerId && o.shopifyCustomerId)
          .map((o) => String(o.shopifyCustomerId))
      )
    );

    const orphanMap: Map<
      string,
      { id: string; salonName: string | null; customerName: string | null; salesRepId: string | null; salesRep: string | null; shopifyCustomerId: string | null; }
    > =
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
            ).map((c) => [String(c.shopifyCustomerId ?? ""), c])
          )
        : new Map();

    // 3) Rep filter (canonical id OR legacy name)
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

    // 4) Cost map from cache
    const allVariantIds = Array.from(
      new Set(
        filteredOrders.flatMap((o) => o.lineItems.map((li) => String(li.variantId || "")).filter(Boolean))
      )
    );

    const costMap = new Map<string, number>();
    if (allVariantIds.length) {
      const costs = await prisma.shopifyVariantCost.findMany({
        where: { variantId: { in: allVariantIds } },
        select: { variantId: true, unitCost: true },
      });
      for (const c of costs) {
        const key = String(c.variantId);
        if (!costMap.has(key)) costMap.set(key, toNum(c.unitCost));
      }
    }

    // 4b) Auto-backfill any missing costs from Shopify
    const missingVariantIds = allVariantIds.filter((id) => !costMap.has(id));
    if (missingVariantIds.length) {
      const BACKFILL_LIMIT = 200;
      const toFetch = missingVariantIds.slice(0, BACKFILL_LIMIT);
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

    // 5) Aggregate by customer
    const rowsMap = new Map<string, Row>();
    const currency = filteredOrders.find(o => o.currency)?.currency || "GBP";

    for (const o of filteredOrders) {
      const cust =
        o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);

      const customerId = cust?.id ?? null;
      const name = (cust?.salonName || cust?.customerName || "Unlinked customer").trim();
      const key = customerId || `unlinked:${name}`;

      const grossEx = grossFromLines(o.lineItems);
      const taxes = toNum(o.taxes);                      // VAT charged (Shopify calculates after discounts)
      const grossInc = grossEx + taxes;                  // “Gross (inc VAT)” for display (ex VAT lines + VAT)
      const netEx = netExFromOrder({ subtotal: o.subtotal, discounts: o.discounts }, grossEx);
      const discounts = toNum(o.discounts) || Math.max(0, grossEx - netEx); // prefer Shopify field

      // Cost = sum(lineQty * unitCostByVariant)
      let cost = 0;
      for (const li of o.lineItems) {
        const vId = String(li.variantId || "");
        if (!vId) continue;
        const unitCost = costMap.get(vId);
        if (unitCost == null) continue;
        const qty = Number(li.quantity ?? 0) || 0;
        cost += unitCost * qty;
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
          netEx,

          gross: grossInc, // alias for UI
          net: netEx,      // alias for UI

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
        prev.netEx += netEx;

        prev.gross = prev.grossInc; // keep alias in sync
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

    // Provide UI-friendly aliases in totals too
    const totalWithAliases = {
      ...totals,
      gross: totals.grossInc,
      net: totals.netEx,
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
