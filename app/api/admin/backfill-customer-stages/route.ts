// app/api/admin/backfill-customer-stages/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive || user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { adminId: me.id };
}

/** GET = preview how many would change */
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(`
    SELECT COUNT(*)::int AS count
    FROM "Customer" c
    WHERE c."stage" <> 'CUSTOMER'
      AND EXISTS (
        SELECT 1 FROM "Order" o
        WHERE o."customerId" = c."id"
          AND (o."processedAt" IS NOT NULL OR o."total" IS NOT NULL)
      )
  `);

  return NextResponse.json({ wouldUpdate: rows?.[0]?.count ?? 0 });
}

/** POST = perform the backfill */
export async function POST() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Customer" c
    SET "stage" = 'CUSTOMER'
    WHERE c."stage" <> 'CUSTOMER'
      AND EXISTS (
        SELECT 1 FROM "Order" o
        WHERE o."customerId" = c."id"
          AND (o."processedAt" IS NOT NULL OR o."total" IS NOT NULL)
      )
  `);

  return NextResponse.json({ updated });
}
