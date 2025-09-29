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

    // 2) Users with rep-like roles (active people who can log calls)
    const userRows = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ["REP", "MANAGER", "ADMIN"] },
        fullName: { not: null },
      },
      select: { fullName: true },
      orderBy: { fullName: "asc" },
    });
    const namesFromUsers = userRows.map(u => u.fullName as string).filter(Boolean);

    // 3) Distinct staff names from CallLog
    const staffRows = await prisma.callLog.findMany({
      where: { staff: { not: null } },
      select: { staff: true },
      distinct: ["staff"],
    });
    const namesFromLogs = staffRows.map(s => s.staff as string).filter(Boolean);

    // 4) Distinct salesRep from Customer
    const custRows = await prisma.customer.findMany({
      where: { salesRep: { not: null } },
      select: { salesRep: true },
      distinct: ["salesRep"],
    });
    const namesFromCustomers = custRows.map(c => c.salesRep as string).filter(Boolean);

    // Normalize, de-dupe (case-insensitive), and sort
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const name of [
      ...namesFromTbl,
      ...namesFromUsers,
      ...namesFromLogs,
      ...namesFromCustomers,
    ]) {
      const n = norm(name);
      if (!n) continue;
      const key = n.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(n);
      }
    }
    merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    return NextResponse.json({ ok: true, reps: merged });
  } catch (err) {
    console.error("GET /api/sales-reps failed:", err);
    return NextResponse.json(
      { ok: false, reps: [], error: "Failed to load sales reps" },
      { status: 500 }
    );
  }
}
