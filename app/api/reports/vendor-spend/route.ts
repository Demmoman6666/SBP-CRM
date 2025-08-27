// app/api/reports/vendor-spend/route.ts
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

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]) - 1, y = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function endOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Normalize vendor for matching: trim → collapse spaces → uppercase. */
function normVendor(s?: string | null): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Pick the nicest display name for a normalized vendor. */
function displayFor(norm: string, preferred: Record<string, string>, fallbackSeen?: Record<string, string>): string {
  return preferred[norm] || fallbackSeen?.[norm] || norm;
}

/* ---------- GET /api/reports/vendor-spend ---------- */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // filters
  const start = parseDate(searchParams.get("start"));
  const end   = parseDate(searchParams.get("end"));

  // reps: either ?rep=a&rep=b ... or ?reps=a,b
  const reps = (searchParams.getAll("rep").length
    ? searchParams.getAll("rep")
    : (searchParams.get("reps") || "").split(",")
  ).map(s => s.trim()).filter(Boolean);

  // vendors: either ?vendor=x&vendor=y ... or ?vendors=x,y  (these are DISPLAY names)
  const selectedVendorNames = (searchParams.getAll("vendor").length
    ? searchParams.getAll("vendor")
    : (searchParams.get("vendors") || "").split(",")
  ).map(s => s.trim()).filter(Boolean);

  // Prisma where
  const where: any = {};
  if (start || end) {
    where.processedAt = {};
    if (start) (where.processedAt as any).gte = start;
    if (end)   (where.processedAt as any).lte = endOfDayUTC(end);
  }
  if (reps.length) {
    where.customer = { salesRep: { in: reps } };
  }

  // Load stocked brands to define our canonical vendor list (columns)
  const stocked = await prisma.stockedBrand.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });

  // Build maps for normalization => preferred display
  const preferredDisplayByNorm: Record<string, string> = {};
  for (const b of stocked) {
    const n = normVendor(b.name);
    if (n) preferredDisplayByNorm[n] = b.name; // keep original casing from StockedBrand
  }

  // Normalize the selected vendor filter to our codes
  const selectedNorms = new Set(
    selectedVendorNames.map(v => normVendor(v)).filter(Boolean)
  );

  // Pull orders + items
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
    perVendor: Record<string, number>; // keyed by NORMALIZED vendor
    subtotal: number;
    taxes: number;
    total: number;
  };

  const rowsByCustomer = new Map<string, Row>();
  const seenDisplayForNorm: Record<string, string> = {}; // if vendor not in StockedBrand, remember a nice fallback name

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
      const vRaw = (li.productVendor || "").trim();
      if (!vRaw) continue;
      const vNorm = normVendor(vRaw);

      // respect vendor filter if provided (compare normalized)
      if (selectedNorms.size && !selectedNorms.has(vNorm)) continue;

      const lineTotal = toNum(li.total) || (toNum(li.price) * toNum(li.quantity || 1));
      row.perVendor[vNorm] = (row.perVendor[vNorm] || 0) + lineTotal;

      // remember a pretty display if this vendor isn't in StockedBrand
      if (!preferredDisplayByNorm[vNorm]) {
        // keep the first seen casing
        if (!seenDisplayForNorm[vNorm]) seenDisplayForNorm[vNorm] = vRaw;
      }
    }
  }

  // Decide which vendor columns to return:
  //  - If filter provided: exactly the filtered list (in the same order)
  //  - Else: all Stocked Brands; and append any extra vendors present in orders but not in StockedBrand
  let vendors: string[] = [];
  if (selectedNorms.size) {
    vendors = Array.from(selectedNorms).map(n => displayFor(n, preferredDisplayByNorm, seenDisplayForNorm));
  } else {
    const base = stocked.map(b => b.name);
    const extras: string[] = [];
    // discover any additional vendors present in data but not in StockedBrand
    const presentNorms = new Set<string>();
    for (const r of rowsByCustomer.values()) {
      for (const vNorm of Object.keys(r.perVendor)) {
        if (!preferredDisplayByNorm[vNorm]) presentNorms.add(vNorm);
      }
    }
    for (const n of Array.from(presentNorms).sort()) {
      extras.push(displayFor(n, preferredDisplayByNorm, seenDisplayForNorm));
    }
    vendors = [...base, ...extras];
  }

  // final array (stable sort by salon name)
  const rows = Array.from(rowsByCustomer.values())
    .sort((a, b) => a.salonName.localeCompare(b.salonName));

  // Return vendors as DISPLAY names; rows.perVendor remains normalized keys.
  // Your front-end should render with:
  //   const colNorm = normVendor(displayVendorName);
  //   value = row.perVendor[colNorm] ?? 0
  return NextResponse.json({ vendors, rows });
}
