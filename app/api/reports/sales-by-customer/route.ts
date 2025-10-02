// app/api/reports/sales-by-customer/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function parseDateStart(raw?: string | null): Date | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
  const d = new Date(raw);
  return isNaN(+d) ? null : d;
}
function parseDateEnd(raw?: string | null): Date | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999`);
  const d = new Date(raw);
  return isNaN(+d) ? null : d;
}

/** Line-based ex-VAT math (ignores taxes/shipping; discounts reflected in line.total). */
function addLineAgg(
  agg: { gross: number; net: number; discount: number; cost: number },
  li: { price: any | null; total: any | null; quantity: number | null; variantId?: string | null },
  costByVariant: Map<string, number>
) {
  const price = li.price != null ? Number(li.price) : null;
  const qty = Number(li.quantity ?? 0) || 0;
  const lineGross = price != null && isFinite(price) ? Math.max(0, price * qty) : 0;

  const lineNetRaw =
    li.total != null && isFinite(Number(li.total))
      ? Number(li.total)
      : lineGross;

  const lineNet = Math.max(0, lineNetRaw);
  const lineDiscount = Math.max(0, lineGross - lineNet);

  let unitCost = 0;
  if (li.variantId && costByVariant.has(String(li.variantId))) {
    unitCost = costByVariant.get(String(li.variantId)) || 0;
  }
  const lineCost = Math.max(0, unitCost * qty);

  agg.gross += lineGross;
  agg.net += lineNet;
  agg.discount += lineDiscount;
  agg.cost += lineCost;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const from = parseDateStart(searchParams.get("from"));
  const to = parseDateEnd(searchParams.get("to"));

  const repId = searchParams.get("repId") || undefined;
  const staffName = searchParams.get("staff") || searchParams.get("repName") || undefined;

  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 500), 1), 5000);

  const where: Prisma.OrderWhereInput = {
    ...(from || to
      ? {
          processedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    // include all (paid + unpaid)
    ...(repId || staffName
      ? {
          OR: [
            ...(repId ? [{ customer: { rep: { id: repId } } }] as Prisma.OrderWhereInput[] : []),
            ...(staffName ? [{ customer: { salesRep: staffName } }] as Prisma.OrderWhereInput[] : []),
          ],
        }
      : {}),
  };

  // Pull orders + line items + customer display names
  const orders = await prisma.order.findMany({
    where,
    orderBy: { processedAt: "desc" },
    take: limit,
    select: {
      id: true,
      processedAt: true,
      currency: true,
      customerId: true,
      customer: { select: { salonName: true, customerName: true, salesRep: true, rep: { select: { id: true, name: true } } } },
      lineItems: { select: { price: true, total: true, quantity: true, variantId: true } },
      subtotal: true,
      total: true,
      taxes: true,
      shipping: true,
      discounts: true,
    },
  });

  // Gather all variantIds present to load cached costs
  const variantIds = Array.from(
    new Set(
      orders.flatMap((o) => o.lineItems.map((li) => li.variantId)).filter((v): v is string => !!v)
    )
  );

  // Load cached costs
  const costs = await prisma.shopifyVariantCost.findMany({
    where: { variantId: { in: variantIds } },
    select: { variantId: true, unitCost: true },
  });
  const costByVariant = new Map<string, number>();
  for (const c of costs) {
    if (c.unitCost != null) costByVariant.set(c.variantId, Number(c.unitCost));
  }

  type Row = {
    customerId: string;
    customer: string;
    repName: string | null;
    orders: number;
    gross: number;
    discount: number;
    net: number;
    marginPct: number | null;
    currency: string;
  };

  const byCustomer = new Map<string, Row>();

  for (const o of orders) {
    const cid = o.customerId ?? "unknown";
    const cname = o.customer?.salonName || o.customer?.customerName || "—";
    const repName = o.customer?.rep?.name || o.customer?.salesRep || null;
    const currency = o.currency || "GBP";

    if (!byCustomer.has(cid)) {
      byCustomer.set(cid, {
        customerId: cid,
        customer: cname,
        repName,
        orders: 0,
        gross: 0,
        discount: 0,
        net: 0,
        marginPct: null,
        currency,
      });
    }
    const row = byCustomer.get(cid)!;

    row.orders += 1;

    if (o.lineItems && o.lineItems.length > 0) {
      const agg = { gross: 0, net: 0, discount: 0, cost: 0 };
      for (const li of o.lineItems) {
        addLineAgg(agg, li, costByVariant);
      }
      row.gross += agg.gross;
      row.net += agg.net;
      row.discount += agg.discount;

      // compute margin% when we have at least some cost; if none, leave as null
      if (agg.cost > 0 && row.net + agg.net >= 0) {
        const netForCalc = agg.net;
        const marginPct = netForCalc > 0 ? ((netForCalc - agg.cost) / netForCalc) * 100 : null;
        // blend with previous (weighted by net)
        if (row.marginPct == null) {
          row.marginPct = marginPct;
        } else if (marginPct != null) {
          const prevNet = row.net;
          const prevMarginVal = (row.marginPct / 100) * (prevNet || 0);
          const thisMarginVal = ((marginPct || 0) / 100) * (netForCalc || 0);
          const combinedNet = prevNet + netForCalc;
          row.marginPct = combinedNet > 0 ? ((prevMarginVal + thisMarginVal) / combinedNet) * 100 : null;
        }
      }
    } else {
      // Fallback using order-level fields if no lines: net ~ subtotal; gross ~ subtotal+discounts
      const subtotal = o.subtotal != null ? Number(o.subtotal) : 0;
      const discounts = o.discounts != null ? Number(o.discounts) : 0;
      const grossApprox = Math.max(0, subtotal + Math.max(0, discounts));

      row.gross += grossApprox;
      row.net += Math.max(0, subtotal);
      row.discount += Math.max(0, discounts);
      // No cost without line variants; margin remains null
    }
  }

  const rows = Array.from(byCustomer.values())
    .sort((a, b) => b.net - a.net);

  return NextResponse.json({
    ok: true,
    from: from?.toISOString() || null,
    to: to?.toISOString() || null,
    count: rows.length,
    rows,
  });
}
