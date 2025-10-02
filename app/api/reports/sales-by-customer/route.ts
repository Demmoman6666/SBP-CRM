// app/api/reports/sales-by-customer/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  customerId: string | null;
  customerName: string;
  orders: number;
  grossEx: number;
  discounts: number;
  netEx: number;
  cost: number;
  margin: number;
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

/** sum of line totals (pre-discount), ex VAT */
function grossFromLines(lines: { total: any | null; price: any | null; quantity: number | null }[]): number {
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

/** net ex VAT, after discounts, before shipping. Prefer Order.subtotal. */
function netExFromOrder(o: {
  subtotal: any | null;
  discounts: any | null;
  shipping: any | null;
}, grossEx: number): number {
  const sub = o.subtotal != null ? toNum(o.subtotal) : null;
  if (sub != null && Number.isFinite(sub)) return Math.max(0, sub);
  const disc = toNum(o.discounts);
  // shipping is ex-VAT too, but we exclude it from revenue calc entirely
  return Math.max(0, grossEx - disc);
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

    // 1) Pull all orders in range (paid + unpaid), with line items & lightweight customer info
    const orders = await prisma.order.findMany({
      where: {
        processedAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        processedAt: true,
        currency: true,
        customerId: true,
        shopifyCustomerId: true,
        subtotal: true,
        discounts: true,
        shipping: true,
        customer: {
          select: {
            id: true,
            salonName: true,
            customerName: true,
            salesRepId: true,
            salesRep: true, // legacy text
          },
        },
        lineItems: {
          select: { variantId: true, quantity: true, price: true, total: true },
        },
      },
      orderBy: { processedAt: "asc" },
    });

    if (!orders.length) {
      return NextResponse.json({ rows: [], total: { grossEx: 0, discounts: 0, netEx: 0, cost: 0, margin: 0 }, currency: "GBP" });
    }

    // 2) For orders without a customer relation, try to link by shopifyCustomerId
    const orphanShopIds = Array.from(
      new Set(
        orders
          .filter(o => !o.customerId && o.shopifyCustomerId)
          .map(o => String(o.shopifyCustomerId))
      )
    );
    const orphanMap: Map<string, { id: string; salonName: string | null; customerName: string | null; salesRepId: string | null; salesRep: string | null }> =
      orphanShopIds.length
        ? new Map(
            (await prisma.customer.findMany({
              where: { shopifyCustomerId: { in: orphanShopIds } },
              select: { id: true, salonName: true, customerName: true, salesRepId: true, salesRep: true },
            })).map(c => [String((c as any).shopifyCustomerId ?? ""), c])
          )
        : new Map();

    // 3) If a rep filter is present, apply it now using canonical id OR legacy name
    const filteredOrders = orders.filter(o => {
      const c = o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);
      if (!repId && !repNameForFilter) return true;
      if (!c) return false;
      const idMatch = repId && c.salesRepId ? c.salesRepId === repId : false;
      const nameMatch = repNameForFilter && c.salesRep ? (c.salesRep || "").trim().toLowerCase() === repNameForFilter.trim().toLowerCase() : false;
      return Boolean(idMatch || nameMatch);
    });

    if (!filteredOrders.length) {
      return NextResponse.json({ rows: [], total: { grossEx: 0, discounts: 0, netEx: 0, cost: 0, margin: 0 }, currency: orders[0]?.currency || "GBP" });
    }

    // 4) Build a cost map from cached ShopifyVariantCost (latest per variantId)
    const allVariantIds = Array.from(
      new Set(
        filteredOrders.flatMap(o =>
          o.lineItems.map(li => String(li.variantId || "")).filter(Boolean)
        )
      )
    );
    const costMap = new Map<string, number>();
    if (allVariantIds.length) {
      const costs = await prisma.shopifyVariantCost.findMany({
        where: { variantId: { in: allVariantIds } },
        orderBy: { recordedAt: "desc" },
        select: { variantId: true, unitCost: true, recordedAt: true },
      });
      for (const c of costs) {
        const key = String(c.variantId);
        if (!costMap.has(key)) costMap.set(key, toNum(c.unitCost));
      }
    }

    // 5) Aggregate by customer
    const rowsMap = new Map<string, Row>();
    let currency = filteredOrders[0]?.currency || "GBP";

    for (const o of filteredOrders) {
      const cust = o.customer ?? (o.shopifyCustomerId ? orphanMap.get(String(o.shopifyCustomerId)) ?? null : null);

      const customerId = cust?.id ?? null;
      const name = (cust?.salonName || cust?.customerName || "Unlinked customer").trim();
      const key = customerId || `unlinked:${name}`;

      const grossEx = grossFromLines(o.lineItems);
      const netEx = netExFromOrder({ subtotal: o.subtotal, discounts: o.discounts, shipping: o.shipping }, grossEx);
      const discounts = Math.max(0, grossEx - netEx);

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
          discounts,
          netEx,
          cost,
          margin,
          marginPct: netEx > 0 ? (margin / netEx) * 100 : null,
          currency: o.currency || currency,
        });
      } else {
        prev.orders += 1;
        prev.grossEx += grossEx;
        prev.discounts += discounts;
        prev.netEx += netEx;
        prev.cost += cost;
        prev.margin = Math.max(0, prev.netEx - prev.cost);
        prev.marginPct = prev.netEx > 0 ? (prev.margin / prev.netEx) * 100 : null;
      }
    }

    const rows = Array.from(rowsMap.values()).sort((a, b) => b.netEx - a.netEx);

    const totals = rows.reduce(
      (acc, r) => {
        acc.grossEx += r.grossEx;
        acc.discounts += r.discounts;
        acc.netEx += r.netEx;
        acc.cost += r.cost;
        acc.margin += r.margin;
        return acc;
      },
      { grossEx: 0, discounts: 0, netEx: 0, cost: 0, margin: 0 }
    );

    return NextResponse.json({
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      currency,
      rows,
      total: totals,
    });
  } catch (err: any) {
    console.error("sales-by-customer error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
