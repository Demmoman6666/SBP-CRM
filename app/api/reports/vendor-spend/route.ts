// app/api/reports/vendor-spend/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function toNum(v: any): number {
  if (v == null) return 0;
  try {
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v) || 0;
    if (typeof v === "object" && "toNumber" in v) {
      return (v as any).toNumber?.() ?? 0; // Prisma Decimal
    }
  } catch {}
  return Number(v) || 0;
}

function liTotal(li: any): number {
  const t = toNum(li.total);
  if (t) return t;
  return toNum(li.price) * Number(li.quantity ?? 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // reps filter: ?rep=Alex&rep=Laura OR ?reps=Alex,Laura
  const repsParam = searchParams.getAll("rep").concat(searchParams.getAll("reps"));
  const repsFromCsv = (searchParams.get("reps") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const reps = Array.from(new Set([...repsParam, ...repsFromCsv].map(s => s.trim()).filter(Boolean)));

  // vendors filter: ?vendors=Wella,Matrix (case-sensitive like Shopify)
  const vendors = Array.from(
    new Set(
      (searchParams.get("vendors") || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    ),
  );

  const from = searchParams.get("from") || searchParams.get("date_from");
  const to   = searchParams.get("to")   || searchParams.get("date_to");

  const where: any = {};
  if (vendors.length) where.productVendor = { in: vendors };
  where.order = {};
  if (reps.length) where.order.customer = { salesRep: { in: reps } };
  if (from || to) {
    where.order.processedAt = {};
    if (from) (where.order.processedAt as any).gte = new Date(from);
    if (to)   (where.order.processedAt as any).lte = new Date(to);
  }

  // Pull matching line items with minimal order+customer context
  const lines = await prisma.orderLineItem.findMany({
    where,
    select: {
      productVendor: true,
      total: true,
      price: true,
      quantity: true,
      order: {
        select: {
          id: true,
          currency: true,
          processedAt: true,
          customerId: true,
          customer: {
            select: {
              id: true,
              salonName: true,
              customerName: true,
              salesRep: true,
            },
          },
        },
      },
    },
  });

  type Row = {
    customerId: string;
    salonName: string;
    customerName: string;
    salesRep: string | null;
    vendor: string | null;
    total: number;
    currency: string | null;
  };

  // Group by customer × vendor
  const map = new Map<string, Row>();
  for (const li of lines) {
    const cust = li.order.customer;
    if (!cust) continue;
    const key = `${cust.id}||${li.productVendor ?? ""}`;
    const amt = liTotal(li);
    const existing = map.get(key);
    if (existing) {
      existing.total += amt;
    } else {
      map.set(key, {
        customerId: cust.id,
        salonName: cust.salonName ?? "",
        customerName: cust.customerName ?? "",
        salesRep: cust.salesRep ?? null,
        vendor: li.productVendor ?? null,
        total: amt,
        currency: li.order.currency ?? null,
      });
    }
  }

  const rows = Array.from(map.values()).sort(
    (a, b) =>
      (a.salonName || "").localeCompare(b.salonName || "") ||
      (a.vendor || "").localeCompare(b.vendor || ""),
  );

  // Optional totals by customer (handy for the UI)
  const totalsByCustomer: Record<string, number> = {};
  for (const r of rows) {
    totalsByCustomer[r.customerId] = (totalsByCustomer[r.customerId] || 0) + r.total;
  }

  return NextResponse.json({
    params: { reps, vendors, from: from || null, to: to || null },
    count: rows.length,
    rows,
    totalsByCustomer,
  });
}
