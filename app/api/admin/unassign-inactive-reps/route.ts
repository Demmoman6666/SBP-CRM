import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { pushCustomerToShopifyById } from "@/lib/shopify";

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
  const syncShopify = searchParams.get("shopify") !== "0";

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

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
      shopifyCustomerId: true,
      rep: { select: { name: true } },
      orders: {
        select: { processedAt: true },
        orderBy: { processedAt: "desc" },
        take: 1,
      },
    },
  });

  const toUnassign = assigned.filter(c => {
    const lastOrder = c.orders[0]?.processedAt;
    if (!lastOrder) return true;
    return new Date(lastOrder) < cutoff;
  });

  if (!confirm) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      days,
      cutoff: cutoff.toISOString().slice(0, 10),
      wouldUnassign: toUnassign.length,
      total: assigned.length,
      withShopifyId: toUnassign.filter(c => c.shopifyCustomerId).length,
      withoutShopifyId: toUnassign.filter(c => !c.shopifyCustomerId).length,
      preview: toUnassign.slice(0, 50).map(c => ({
        id: c.id,
        salonName: c.salonName,
        repName: c.rep?.name || c.salesRep || null,
        lastOrderAt: c.orders[0]?.processedAt?.toISOString().slice(0, 10) || null,
        hasShopifyId: !!c.shopifyCustomerId,
      })),
    });
  }

  let unassignedCrm = 0;
  let shopifyUpdated = 0;
  let shopifyFailed = 0;
  const errors: string[] = [];

  for (const c of toUnassign) {
    try {
      await prisma.customer.update({
        where: { id: c.id },
        data: { salesRepId: null, salesRep: null },
      });
      unassignedCrm++;

      if (syncShopify && c.shopifyCustomerId) {
        try {
          await pushCustomerToShopifyById(c.id);
          shopifyUpdated++;
        } catch (shopifyErr: any) {
          shopifyFailed++;
          errors.push(`${c.salonName}: Shopify failed — ${shopifyErr?.message || "unknown"}`);
        }
      }
    } catch (err: any) {
      errors.push(`${c.salonName}: CRM failed — ${err?.message || "unknown"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    days,
    unassignedCrm,
    shopifyUpdated,
    shopifyFailed,
    message: `Removed rep from ${unassignedCrm} customers in CRM, updated ${shopifyUpdated} in Shopify.`,
    errors: errors.slice(0, 20),
  });
}
