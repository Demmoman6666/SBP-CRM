// app/api/sales-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // 1) Primary source: SalesRep table
    const repsTbl = await prisma.salesRep.findMany({
      select: { name: true },
      orderBy: { name: "asc" },
    });
    const namesFromTbl = repsTbl.map(r => r.name).filter(Boolean);

    // 2) Fallback A: distinct staff names from CallLog
    const staffRows = await prisma.callLog.findMany({
      where: { staff: { not: null } },
      select: { staff: true },
      distinct: ["staff"],
    });
    const namesFromLogs = staffRows.map(s => s.staff as string).filter(Boolean);

    // 3) Fallback B: distinct salesRep from Customer
    const custRows = await prisma.customer.findMany({
      where: { salesRep: { not: null } },
      select: { salesRep: true },
      distinct: ["salesRep"],
    });
    const namesFromCustomers = custRows.map(c => c.salesRep as string).filter(Boolean);

    // Dedupe + sort nicely
    const reps = Array.from(
      new Set([...namesFromTbl, ...namesFromLogs, ...namesFromCustomers])
    )
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    // Shape that the coverage map page expects
    return NextResponse.json({ ok: true, reps });
  } catch (err) {
    console.error("GET /api/sales-reps failed:", err);
    return NextResponse.json({ ok: false, reps: [], error: "Failed to load sales reps" }, { status: 500 });
  }
}
