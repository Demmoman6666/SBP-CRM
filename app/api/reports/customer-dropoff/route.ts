// app/api/reports/customer-dropoff/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseIntStrict(v: any, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : dflt;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // days threshold: 7 / 14 / 21 / 28 / custom
  const bucket = (searchParams.get("bucket") || "").toLowerCase();
  let days = parseIntStrict(searchParams.get("days"), 7);
  if (!searchParams.has("days")) {
    if (bucket === "7") days = 7;
    else if (bucket === "14") days = 14;
    else if (bucket === "21") days = 21;
    else if (bucket === "28") days = 28;
  }

  // sales rep filters: ?rep=Alice&rep=Bob  OR ?reps=Alice,Bob
  const repsRaw =
    searchParams.getAll("rep").length
      ? searchParams.getAll("rep")
      : (searchParams.get("reps") || "").split(",");
  const reps = repsRaw.map(s => s.trim()).filter(Boolean);

  // Base customers set (optionally filtered by sales rep)
  const whereCustomer: any = {};
  if (reps.length) whereCustomer.salesRep = { in: reps };

  const customers = await prisma.customer.findMany({
    where: whereCustomer,
    select: {
      id: true,
      salonName: true,
      customerName: true,
      salesRep: true,
      createdAt: true,
    },
  });
  const ids = customers.map(c => c.id);
  if (ids.length === 0) {
    return NextResponse.json({
      asOf: new Date().toISOString(),
      days,
      total: 0,
      rows: [],
    });
  }

  // Last order per customer (groupBy _max.processedAt)
  const lastOrders = await prisma.order.groupBy({
    by: ["customerId"],
    _max: { processedAt: true },
    where: { customerId: { in: ids } },
  });

  const lastMap = new Map<string, Date | null>();
  for (const c of customers) lastMap.set(c.id, null);
  for (const g of lastOrders) {
    if (!g.customerId) continue;
    lastMap.set(g.customerId, g._max.processedAt ?? null);
  }

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  // Build rows; include customers with no order ever OR last order older than threshold
  const rows = customers
    .map(c => {
      const last = lastMap.get(c.id);
      const daysSince = last ? Math.floor((now - new Date(last).getTime()) / msPerDay) : Number.POSITIVE_INFINITY;
      return {
        customerId: c.id,
        salonName: c.salonName || c.customerName || "(Unnamed)",
        customerName: c.customerName || null,
        salesRep: c.salesRep || null,
        lastOrderAt: last ? new Date(last).toISOString() : null,
        daysSince,
      };
    })
    .filter(r => r.daysSince >= days); // "hasn't ordered in the last X days"

  // Stable sort: most overdue first, then salon
  rows.sort((a, b) => {
    if (a.daysSince === b.daysSince) return a.salonName.localeCompare(b.salonName);
    return b.daysSince - a.daysSince;
  });

  return NextResponse.json({
    asOf: new Date().toISOString(),
    days,
    total: rows.length,
    rows,
  });
}
