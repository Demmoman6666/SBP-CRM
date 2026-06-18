import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const repId = url.searchParams.get("repId") || null;

    const brands = await prisma.stockedBrand.findMany({
      where: { visibleInReports: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    if (brands.length === 0) return NextResponse.json({ brands: [], rows: [], summary: [], buckets: null, total: 0 });

    const brandNames = brands.map(b => b.name);

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) { const t = new Date(to); t.setHours(23, 59, 59, 999); dateFilter.lte = t; }

    const customers = await prisma.customer.findMany({
      where: repId ? { salesRepId: repId } : undefined,
      select: { id: true, salonName: true, salesRep: true, salesRepId: true, rep: { select: { name: true } }, stage: true },
      orderBy: { salonName: "asc" },
    });

    if (customers.length === 0) return NextResponse.json({ brands: brandNames, rows: [], summary: [], buckets: null, total: 0 });

    const customerIds = customers.map(c => c.id);

    const orders = await prisma.order.findMany({
      where: { customerId: { in: customerIds }, ...(Object.keys(dateFilter).length ? { processedAt: dateFilter } : {}) },
      select: { customerId: true, lineItems: { select: { productVendor: true, quantity: true } } },
    });

    const customerBrands = new Map<string, Set<string>>();
    for (const order of orders) {
      if (!order.customerId) continue;
      if (!customerBrands.has(order.customerId)) customerBrands.set(order.customerId, new Set());
      for (const li of order.lineItems) {
        if (li.productVendor && brandNames.includes(li.productVendor)) {
          customerBrands.get(order.customerId)!.add(li.productVendor);
        }
      }
    }

    const rows = customers.map(c => {
      const bought = customerBrands.get(c.id) || new Set<string>();
      const brandData: Record<string, boolean> = {};
      for (const b of brandNames) brandData[b] = bought.has(b);
      return { customerId: c.id, salonName: c.salonName, salesRep: c.rep?.name || c.salesRep || null, stage: c.stage, brands: brandData, count: bought.size, allFour: bought.size === brandNames.length };
    });

    const summary = brandNames.map(b => ({ brand: b, customers: rows.filter(r => r.brands[b]).length, pct: rows.length > 0 ? Math.round((rows.filter(r => r.brands[b]).length / rows.length) * 100) : 0 }));

    const buckets = { all: rows.filter(r => r.count === brandNames.length).length, three: rows.filter(r => r.count === 3).length, two: rows.filter(r => r.count === 2).length, one: rows.filter(r => r.count === 1).length, none: rows.filter(r => r.count === 0).length };

    return NextResponse.json({ brands: brandNames, rows, summary, buckets, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
