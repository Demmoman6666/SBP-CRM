// app/api/reports/vendor-spend/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/* ---------- helpers ---------- */
function toNum(v: any): number {
  // robust Number() for Prisma Decimal | string | null
  if (v == null) return 0;
  try {
    // Prisma Decimal has toNumber()
    if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as any).toNumber === "function") {
      return Number((v as any).toNumber() ?? 0);
    }
  } catch {}
  const n = Number(v);
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
    const d = Number(m[1]),
      mo = Number(m[2]) - 1,
      y = Number(m[3]);
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

/** Normalize vendor names to a stable key:
 *  - NFKC normalize
 *  - lower-case
 *  - collapse all non-alphanumerics to spaces
 *  - collapse repeated spaces, trim
 *  So: "MY.ORGANICS" -> "my organics", "REF  Stockholm" -> "ref stockholm"
 */
function normVendor(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- GET /api/reports/vendor-spend ---------- */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // filters
  const start = parseDate(searchParams.get("start"));
  const end = parseDate(searchParams.get("end"));

  const reps = (searchParams.getAll("rep").length
    ? searchParams.getAll("rep")
    : (searchParams.get("reps") || "").split(",")
  )
    .map((s) => s.trim())
    .filter(Boolean);

  const selectedVendorsRaw = (searchParams.getAll("vendor").length
    ? searchParams.getAll("vendor")
    : (searchParams.get("vendors") || "").split(",")
  )
    .map((s) => s.trim())
    .filter(Boolean);

  // Load StockedBrand list to get canonical display names for vendors
  const stocked = await prisma.stockedBrand.findMany({ select: { name: true } });
  const canonicalByKey = new Map<string, string>(); // normKey -> Canonical Display
  for (const b of stocked) {
    const label = (b.name || "").trim();
    if (!label) continue;
    canonicalByKey.set(normVendor(label), label);
  }

  // Convert selected vendor labels -> normalized keys for server-side filtering
  const selectedVendorKeys = new Set<string>(selectedVendorsRaw.map(normVendor));

  // prisma where
  const where: any = {};
  if (start || end) {
    where.processedAt = {};
    if (start) (where.processedAt as any).gte = start;
    if (end) (where.processedAt as any).lte = endOfDayUTC(end);
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
      lineItems: {
        select: {
          productVendor: true,
          quantity: true,
          price: true,
          total: true,
        },
      },
    },
  });

  // aggregate by customer
  type Row = {
    customerId: string;
    salonName: string;
    salesRep: string | null;
    perVendor: Record<string, number>; // keys are *display labels*
    subtotal: number;
    taxes: number;
    total: number;
  };

  const rowsByCustomer = new Map<string, Row>();
  const vendorUniverseLabels = new Set<string>(); // display labels we actually encountered

  for (const o of orders) {
    if (!o.customer) continue;
    const cid = o.customer.id;

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

    // order-level money
    row.subtotal += toNum(o.subtotal);
    row.taxes += toNum(o.taxes);
    row.total += toNum(o.total);

    // vendor spend (normalize & align to canonical labels)
    for (const li of o.lineItems) {
      const raw = (li.productVendor || "").trim();
      if (!raw) continue;

      const key = normVendor(raw);
      if (!key) continue;

      // if the user selected vendors, only include matching keys
      if (selectedVendorKeys.size && !selectedVendorKeys.has(key)) continue;

      // choose display label: prefer StockedBrand canonical; otherwise use first-seen raw label
      const label = canonicalByKey.get(key) || raw;

      const lineTotal = toNum(li.total) || toNum(li.price) * toNum(li.quantity || 1);
      row.perVendor[label] = (row.perVendor[label] || 0) + lineTotal;
      vendorUniverseLabels.add(label);
    }
  }

  // Which vendor columns to show
  // If user selected vendors: show them (using canonical labels where possible)
  // Otherwise: show every label we discovered in this result set (sorted)
  let vendors: string[];
  if (selectedVendorsRaw.length) {
    vendors = selectedVendorsRaw
      .map((v) => canonicalByKey.get(normVendor(v)) || v)
      .filter((v, i, a) => a.indexOf(v) === i);
  } else {
    vendors = Array.from(vendorUniverseLabels).sort((a, b) => a.localeCompare(b));
  }

  // final rows sorted by salon name
  const rows = Array.from(rowsByCustomer.values()).sort((a, b) => a.salonName.localeCompare(b.salonName));

  return NextResponse.json({ vendors, rows });
}
