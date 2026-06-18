// app/api/admin/unassign-inactive-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: me.id }, select: { role: true } });
  if (user?.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, parseInt(searchParams.get("days") || "90", 10));
  const confirm = searchParams.get("confirm") === "1";

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Find all customers who have a rep assigned
  const assigned = await prisma.customer.findMany({
    where: {
      OR: [
        { salesRepId: { not: null } },
        { salesRep: { not: null } },
      ],
    },
    select: {
      id: true,
      salonName: true,
      salesRep: true,
      salesRepId: true,
      rep: { select: { name: true } },
      orders: {
        select: { processedAt: true },
        orderBy: { processedAt: "desc" },
        take: 1,
      },
    },
  });

  // Find which ones have no order in the last X days
  const toUnassign = assigned.filter(c => {
    const lastOrder = c.orders[0]?.processedAt;
    if (!lastOrder) return true; // never ordered — unassign
    return new Date(lastOrder) < cutoff;
  });

  if (!confirm) {
    // Dry run — just return the preview
    return NextResponse.json({
      ok: true,
      dryRun: true,
      days,
      cutoff: cutoff.toISOString().slice(0, 10),
      wouldUnassign: toUnassign.length,
      total: assigned.length,
      preview: toUnassign.slice(0, 50).map(c => ({
        id: c.id,
        salonName: c.salonName,
        repName: c.rep?.name || c.salesRep || null,
        lastOrderAt: c.orders[0]?.processedAt?.toISOString().slice(0, 10) || null,
      })),
    });
  }

  // Commit — unassign rep from all matching customers
  const ids = toUnassign.map(c => c.id);
  await prisma.customer.updateMany({
    where: { id: { in: ids } },
    data: { salesRepId: null, salesRep: null },
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    days,
    unassigned: ids.length,
    message: `Removed rep assignment from ${ids.length} customers with no orders in the last ${days} days.`,
  });
}
