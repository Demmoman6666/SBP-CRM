// app/api/sales-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // 1) SalesRep table
    let namesFromTbl: string[] = [];
    try {
      const repsTbl = await prisma.salesRep.findMany({
        select: { name: true },
        orderBy: { name: "asc" },
      });
      namesFromTbl = repsTbl.map(r => r.name).filter(Boolean);
    } catch (e) {
      console.error("salesRep.findMany failed:", e);
    }

    // 2) Active users with rep-like roles
    let namesFromUsers: string[] = [];
    try {
      const userRows = await prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [Role.REP, Role.MANAGER, Role.ADMIN] },
          // fullName is non-nullable in your schema, but keep guard anyway:
          fullName: { not: null },
        },
        select: { fullName: true },
      });
      namesFromUsers = userRows.map(u => u.fullName as string).filter(Boolean);
    } catch (e) {
      console.error("user.findMany failed:", e);
    }

    // 3) Distinct staff from CallLog
    let namesFromLogs: string[] = [];
    try {
      const staffRows = await prisma.callLog.findMany({
        where: { staff: { not: null } },
        select: { staff: true },
        distinct: ["staff"],
      });
      namesFromLogs = staffRows.map(s => s.staff as string).filter(Boolean);
    } catch (e) {
      console.error("callLog.findMany(distinct staff) failed:", e);
    }

    // 4) Distinct salesRep from Customer
    let namesFromCustomers: string[] = [];
    try {
      const custRows = await prisma.customer.findMany({
        where: { salesRep: { not: null } },
        select: { salesRep: true },
        distinct: ["salesRep"],
      });
      namesFromCustomers = custRows.map(c => c.salesRep as string).filter(Boolean);
    } catch (e) {
      console.error("customer.findMany(distinct salesRep) failed:", e);
    }

    // Normalize + de-dupe case-insensitively
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
    console.error("GET /api/sales-reps failed (outer):", err);
    return NextResponse.json(
      { ok: false, reps: [], error: "Failed to load sales reps" },
      { status: 500 }
    );
  }
}
