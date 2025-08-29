// app/api/targets/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TargetScope, TargetMetric } from "@prisma/client";

export const dynamic = "force-dynamic";

// GET /api/targets?scope=&metric=&repId=&vendorId=&start=YYYY-MM&end=YYYY-MM
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const scope = searchParams.get("scope") as TargetScope | null;
  const metric = searchParams.get("metric") as TargetMetric | null;
  const repId = searchParams.get("repId");
  const vendorId = searchParams.get("vendorId");

  // accept month inputs (YYYY-MM) or full ISO dates
  const parseDate = (v: string | null): Date | null => {
    if (!v) return null;
    if (/^\d{4}-\d{2}$/.test(v)) return new Date(`${v}-01T00:00:00Z`);
    const d = new Date(v);
    return isNaN(+d) ? null : d;
  };
  const start = parseDate(searchParams.get("start"));
  const end = parseDate(searchParams.get("end"));

  const where: any = {};
  if (scope) where.scope = scope;
  if (metric) where.metric = metric;
  if (repId) where.repId = repId;
  if (vendorId) where.vendorId = vendorId;
  if (start) where.periodStart = { gte: start };
  if (end) where.periodEnd = { lte: end };

  const rows = await prisma.target.findMany({
    where,
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ targets: rows });
}

// POST /api/targets  (upsert by unique bucket+period)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const scope = String(body.scope || "REP").toUpperCase() as TargetScope;
  const metric = String(body.metric || "REVENUE").toUpperCase() as TargetMetric;
  const repId = body.repId ? String(body.repId) : null;
  const vendorId = body.vendorId ? String(body.vendorId) : null;
  const currency = body.currency ? String(body.currency) : "GBP";

  // Expect YYYY-MM for convenience; fallback to full date
  const toDate = (v: any, endOfMonth = false) => {
    if (!v) return null;
    if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) {
      const d = new Date(`${v}-01T00:00:00Z`);
      if (endOfMonth) {
        const e = new Date(d);
        e.setUTCMonth(e.getUTCMonth() + 1);
        e.setUTCDate(0); // last day prev month
        e.setUTCHours(23, 59, 59, 999);
        return e;
      }
      return d;
    }
    const d = new Date(v);
    return isNaN(+d) ? null : d;
  };

  const periodStart = toDate(body.periodStart || body.month || body.start, false);
  const periodEnd = toDate(body.periodEnd || body.month || body.end, true);

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Invalid or missing periodStart/periodEnd" }, { status: 400 });
  }

  const amountNum = Number(body.amount);
  if (!Number.isFinite(amountNum)) {
    return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
  }

  // Ensure dims align with scope
  if (scope === "REP" && !repId) {
    return NextResponse.json({ error: "repId required for REP scope" }, { status: 400 });
  }
  if (scope === "VENDOR" && !vendorId) {
    return NextResponse.json({ error: "vendorId required for VENDOR scope" }, { status: 400 });
  }

  // Upsert on unique key
  const target = await prisma.target.upsert({
    where: {
      scope_metric_periodStart_periodEnd_repId_vendorId: {
        scope,
        metric,
        periodStart,
        periodEnd,
        repId: repId ?? null,
        vendorId: vendorId ?? null,
      },
    },
    update: {
      amount: amountNum,
      currency,
      notes: body.notes ? String(body.notes) : null,
    },
    create: {
      scope,
      metric,
      periodStart,
      periodEnd,
      amount: amountNum,
      currency,
      repId,
      vendorId,
      notes: body.notes ? String(body.notes) : null,
    },
  });

  return NextResponse.json({ ok: true, target });
}
