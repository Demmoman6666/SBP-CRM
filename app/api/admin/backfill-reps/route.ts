// app/api/admin/backfill-reps/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { normRepName, getOrCreateRepIdByName } from "@/lib/reps";

export async function GET(req: Request) {
  try {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: me.id }, select: { role: true } });
    if (user?.role !== "ADMIN" && user?.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    if (!searchParams.get("confirm")) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        message: "Add ?confirm=1 to perform the backfill.",
      });
    }

    // 1) Gather all legacy names
    const custNames = await prisma.customer.findMany({
      where: { salesRep: { not: null } },
      select: { salesRep: true },
      distinct: ["salesRep"],
    });
    const callNames = await prisma.callLog.findMany({
      where: { staff: { not: null } },
      select: { staff: true },
      distinct: ["staff"],
    });

    const names = new Set<string>();
    for (const c of custNames) {
      const n = normRepName(String(c.salesRep ?? ""));
      if (n) names.add(n);
    }
    for (const c of callNames) {
      const n = normRepName(String(c.staff ?? ""));
      if (n) names.add(n);
    }

    // 2) Ensure SalesRep rows exist for every name
    const nameToId = new Map<string, string>();
    for (const name of names) {
      const id = await getOrCreateRepIdByName(name);
      if (id) nameToId.set(name, id);
    }

    // 3) Backfill Customer.salesRepId
    let custUpdated = 0;
    for (const [name, repId] of nameToId.entries()) {
      const r = await prisma.customer.updateMany({
        where: {
          salesRepId: null,
          salesRep: { equals: name, mode: "insensitive" },
        },
        data: { salesRepId: repId },
      });
      custUpdated += r.count;
    }

    // 4) Backfill CallLog.repId
    let callUpdated = 0;
    for (const [name, repId] of nameToId.entries()) {
      const r = await prisma.callLog.updateMany({
        where: {
          repId: null,
          staff: { equals: name, mode: "insensitive" },
        },
        data: { repId },
      });
      callUpdated += r.count;
    }

    return NextResponse.json({
      ok: true,
      repsEnsured: nameToId.size,
      customersBackfilled: custUpdated,
      callsBackfilled: callUpdated,
    });
  } catch (err: any) {
    console.error("backfill reps failed:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
