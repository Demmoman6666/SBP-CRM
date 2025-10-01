// app/api/sales-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normName(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

export async function GET() {
  try {
    // 1) Read canonical list first
    let reps = await prisma.salesRep.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    // 2) Harvest candidate names from other sources
    const candidates: string[] = [];

    // 2a) Active users with rep-like roles
    try {
      const userRows = await prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [Role.REP, Role.MANAGER, Role.ADMIN] },
        },
        select: { fullName: true },
      });
      for (const u of userRows) {
        const n = normName(String(u.fullName ?? ""));
        if (n) candidates.push(n);
      }
    } catch (e) {
      console.error("user.findMany failed:", e);
    }

    // 2b) Distinct staff from CallLog
    try {
      const staffRows = await prisma.callLog.findMany({
        where: { staff: { not: null } },
        select: { staff: true },
        distinct: ["staff"],
      });
      for (const s of staffRows) {
        const n = normName(String(s.staff ?? ""));
        if (n) candidates.push(n);
      }
    } catch (e) {
      console.error("callLog.findMany(distinct staff) failed:", e);
    }

    // 2c) Distinct salesRep from Customer
    try {
      const custRows = await prisma.customer.findMany({
        where: { salesRep: { not: null } },
        select: { salesRep: true },
        distinct: ["salesRep"],
      });
      for (const c of custRows) {
        const n = normName(String(c.salesRep ?? ""));
        if (n) candidates.push(n);
      }
    } catch (e) {
      console.error("customer.findMany(distinct salesRep) failed:", e);
    }

    // 3) Upsert any candidates that aren't already in SalesRep
    if (candidates.length) {
      const have = new Set(reps.map((r) => r.name.toLowerCase()));
      const seen = new Map<string, string>(); // key -> nicely-cased name
      for (const raw of candidates) {
        const n = normName(raw);
        if (!n) continue;
        const key = n.toLowerCase();
        if (!seen.has(key)) seen.set(key, n);
      }
      const toCreate = Array.from(seen.entries())
        .filter(([key]) => !have.has(key))
        .map(([, name]) => name);

      if (toCreate.length) {
        await Promise.all(
          toCreate.map((name) =>
            prisma.salesRep.upsert({
              where: { name }, // name is unique in schema
              update: {},
              create: { name },
            })
          )
        );

        // Re-read canonical list after upserts
        reps = await prisma.salesRep.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        });
      }
    }

    // 4) Return the flat array (no wrapper), which all pages expect
    return NextResponse.json(reps);
  } catch (err) {
    console.error("GET /api/sales-reps failed (outer):", err);
    // Return an empty array so clients don't explode on shape mismatch
    return NextResponse.json([]);
  }
}
