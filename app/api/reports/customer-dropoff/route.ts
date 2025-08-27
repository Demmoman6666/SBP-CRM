// app/api/reports/customer-dropoff/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/* ---------- small helpers ---------- */
function parseIntStrict(v: any, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : dflt;
}

function csvEscape(s: any): string {
  const raw = s == null ? "" : String(s);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function wantsCSV(req: Request, sp: URLSearchParams) {
  if ((sp.get("format") || "").toLowerCase() === "csv") return true;
  if (sp.get("csv") === "1") return true;
  const accept = (req.headers.get("accept") || "").toLowerCase();
  return accept.includes("text/csv");
}

function ymd(d?: Date | string | null): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/* ---------- GET /api/reports/customer-dropoff ---------- */
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
    // no customers -> early return (CSV or JSON)
    if (!wantsCSV(req, searchParams)) {
      return NextResponse.json({
        asOf: new Date().toISOString(),
        days,
        total: 0,
        rows: [],
      });
    } else {
      const header = ["Salon Name", "Customer Name", "Sales Rep", "Last Order", "Days Since"];
      return new NextResponse(header.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="customer-dropoff.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
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
    .filter(r => r.daysSince >= days);

  // Stable sort: most overdue first, then salon
  rows.sort((a, b) => {
    if (a.daysSince === b.daysSince) return a.salonName.localeCompare(b.salonName);
    return b.daysSince - a.daysSince;
  });

  // ---------- JSON (default) ----------
  if (!wantsCSV(req, searchParams)) {
    return NextResponse.json({
      asOf: new Date().toISOString(),
      days,
      total: rows.length,
      rows,
    });
  }

  // ---------- CSV (when requested) ----------
  const header = ["Salon Name", "Customer Name", "Sales Rep", "Last Order", "Days Since"];
  const lines: string[] = [header.join(",")];

  for (const r of rows) {
    const lastOut = r.lastOrderAt ? ymd(r.lastOrderAt) : "Never";
    // Avoid serializing Infinity in CSV (put blank or "N/A")
    const daysOut = Number.isFinite(r.daysSince) ? String(r.daysSince) : "";
    lines.push([
      csvEscape(r.salonName),
      csvEscape(r.customerName ?? ""),
      csvEscape(r.salesRep ?? ""),
      csvEscape(lastOut),
      csvEscape(daysOut),
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="customer-dropoff.csv"',
      "Cache-Control": "no-store",
    },
  });
}
