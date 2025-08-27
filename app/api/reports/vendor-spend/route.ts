// app/api/reports/vendor-spend/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* ---------------- number/date helpers ---------------- */

function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  try { return Number(v.toString()) || 0; } catch { return 0; }
}

// accept dd/mm/yyyy or ISO-ish
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
const endOfDayUTC = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

/* ---------------- vendor normalization ---------------- */

function canon(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’'`]/g, "'")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const CANON_TO_DISPLAY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const add = (display: string, aliases: string[]) => {
    for (const a of aliases) map[canon(a)] = display;
  };

  add("Goddess", ["Goddess"]);
  add("MY.ORGANICS", ["MY.ORGANICS", "MY ORGANICS", "MyOrganics", "MY ORGANIC", "MYORGANICS"]);
  add("Neal & Wolf", ["Neal & Wolf", "NEAL & WOLF", "Neal+Wolf", "Neal and Wolf", "NEAL AND WOLF"]);
  add("Procare", ["Procare", "ProCare"]);
  add("REF Stockholm", ["REF Stockholm", "REF", "REF. Stockholm", "REF. STOCKHOLM", "Ref Stockholm"]);

  return map;
})();

function toDisplayVendor(raw?: string | null): string | null {
  if (!raw) return null;
  const c = canon(String(raw));
  return CANON_TO_DISPLAY[c] ?? null;
}

/* ---------------- GET /api/reports/vendor-spend ---------------- */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // support from/to or start/end
  const from = parseDate(searchParams.get("from") || searchParams.get("start"));
  const toRaw = parseDate(searchParams.get("to") || searchParams.get("end"));
  const to = toRaw ? endOfDayUTC(toRaw) : null;

  // reps: support rep= & reps=a,b
  const reps =
    (searchParams.getAll("rep").length
      ? searchParams.getAll("rep")
      : (searchParams.get("reps") || "").split(","))
      .map(s => s.trim())
      .filter(Boolean);

  // vendors: support vendor= & vendors=a,b
  const selectedVendors =
    (searchParams.getAll("vendor").length
      ? searchParams.getAll("vendor")
      : (searchParams.get("vendors") || "").split(","))
      .map(s => s.trim())
      .filter(Boolean);

  // build order where
  const orderWhere: any = {};
  if (from || to) {
    orderWhere.processedAt = {};
    if (from) orderWhere.processedAt.gte = from;
    if (to)   orderWhere.processedAt.lte = to;
  }
  if (reps.length) {
    orderWhere.customer = { salesRep: { in: reps } };
  }

  // 1) Pull orders to get per-customer totals
  const orders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true,
      customerId: true,
      subtotal: true,
      taxes: true,
      total: true,
      customer: { select: { id: true, salonName: true, customerName: true, salesRep: true } },
    },
  });

  type Row = {
    customerId: string;
    salonName: string;
    salesRep: string | null;
    vendors: Record<string, number>;
    subtotal: number;
    taxes: number;
    total: number;
  };

  const perCustomer = new Map<string, Row>();

  const ensureRow = (cid: string, salonName: string, salesRep: string | null) => {
    if (!perCustomer.has(cid)) {
      perCustomer.set(cid, {
        customerId: cid,
        salonName,
        salesRep,
        vendors: {},
        subtotal: 0,
        taxes: 0,
        total: 0,
      });
    }
    return perCustomer.get(cid)!;
  };

  for (const o of orders) {
    if (!o.customerId || !o.customer) continue;
    const row = ensureRow(
      o.customerId,
      o.customer.salonName || o.customer.customerName || "(Unnamed)",
      o.customer.salesRep || null
    );
    row.subtotal += toNum(o.subtotal);
    row.taxes    += toNum(o.taxes);
    row.total    += toNum(o.total);
  }

  // 2) Pull line items for vendor spend (normalized)
  const liWhere: any = { order: orderWhere };
  const lineItems = await prisma.orderLineItem.findMany({
    where: liWhere,
    select: {
      total: true,
      price: true,
      quantity: true,
      productVendor: true,
      order: { select: { customerId: true, customer: { select: { salonName: true, salesRep: true } } } },
    },
  });

  const selectedSet = new Set(
    selectedVendors.length ? selectedVendors : ["Goddess", "MY.ORGANICS", "Neal & Wolf", "Procare", "REF Stockholm"]
  );

  for (const li of lineItems) {
    const displayVendor = toDisplayVendor(li.productVendor as any);
    if (!displayVendor) continue;
    if (selectedVendors.length && !selectedSet.has(displayVendor)) continue;

    const cid = li.order.customerId;
    if (!cid || !li.order.customer) continue;

    const row = ensureRow(cid, li.order.customer.salonName || "-", li.order.customer.salesRep || null);
    const value = toNum(li.total) || (toNum(li.price) * (Number(li.quantity) || 0));
    row.vendors[displayVendor] = (row.vendors[displayVendor] || 0) + value;
  }

  const VENDOR_COLUMNS = Array.from(selectedSet);

  const rows = Array.from(perCustomer.values()).sort((a, b) =>
    (a.salonName || "").localeCompare(b.salonName || "", undefined, { sensitivity: "base" })
  );

  return NextResponse.json({
    vendors: VENDOR_COLUMNS,
    rows,
  });
}
