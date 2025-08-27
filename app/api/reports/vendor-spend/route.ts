import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* ---------- helpers ---------- */
function toNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// parse "dd/mm/yyyy" or ISO-ish strings
function parseDate(val?: string | null): Date | null {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]) - 1, y = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
    return isNaN(dt.getTime()) ? null : dt;
  }

  // fallback to Date
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function endOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/* ---------- GET /api/reports/vendor-spend ---------- */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // filters
  const start = parseDate(searchParams.get("start"));
  const end   = parseDate(searchParams.get("end"));
  const reps  = (searchParams.getAll("rep").length
    ? searchParams.getAll("rep")
    : (searchParams.get("reps") || "").split(",")
  ).map(s => s.trim()).filter(Boolean);

  const selectedVendors = (searchParams.getAll("vendor").length
    ? searchParams.getAll("vendor")
    : (searchParams.get("vendors") || "").split(",")
  ).map(s => s.trim()).filter(Boolean);

  // prisma where
  const where: any = {};
  if (start || end) {
    where.processedAt = {};
    if (start) (where.processedAt as any).gte = start;
    if (end)   (where.processedAt as any).lte = endOfDayUTC(end);
  }
  if (reps.length) {
    where.customer = { salesRep: { in: reps } };
  }

  // pull orders + items
  const orders = await prisma.order.findMany({
    where,
    orderBy: { processedAt: "asc" },
    include: {
      customer: { select: { id: true, salonName: true, customerName: true, salesRep: true } },
      lineItems: { select: {
        productVendor: true,
        quantity: true,
        price: true,
        total: true,
      }},
    },
  });

  // aggregate by customer
  type Row = {
    customerId: string;
    salonName: string;
    salesRep: string | null;
    perVendor: Record<string, number>;
    subtotal: number;
    taxes: number;
    total: number;
  };

  const rowsByCustomer = new Map<string, Row>();
  const vendorUniverse = new Set<string>();

  for (const o of orders) {
    if (!o.customer) continue;
    const cid = o.customer.id;

    // init row
    let row = rowsByCustomer.get(cid);
    if (!row) {
      row = {
        customerId: cid,
        salonName: o.customer.salonName || o.customer.customerName || "(Unnamed)",
        salesRep: o.customer.salesRep || null,
        perVendor: {},
        subtotal: 0,
        taxes: 0,
        total: 0,
      };
      rowsByCustomer.set(cid, row);
    }

    // money totals at order level
    row.subtotal += toNum(o.subtotal);
    row.taxes    += toNum(o.taxes);
    row.total    += toNum(o.total);

    // vendor spend (line items)
    for (const li of o.lineItems) {
      const v = (li.productVendor || "").trim();
      if (!v) continue;
      // respect vendor filter if provided
      if (selectedVendors.length && !selectedVendors.includes(v)) continue;

      const lineTotal = toNum(li.total) || (toNum(li.price) * toNum(li.quantity || 1));
      row.perVendor[v] = (row.perVendor[v] || 0) + lineTotal;
      vendorUniverse.add(v);
    }
  }

  // decide which vendor columns to return (filter order or discovered universe)
  const vendors = selectedVendors.length
    ? selectedVendors
    : Array.from(vendorUniverse).sort((a, b) => a.localeCompare(b));

  // final array (stable sort by salon name)
  const rows = Array.from(rowsByCustomer.values())
    .sort((a, b) => a.salonName.localeCompare(b.salonName));

  return NextResponse.json({ vendors, rows });
}
