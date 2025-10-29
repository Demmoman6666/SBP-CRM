// app/api/par/upsert/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { customerId, sku, parQty } = body as { customerId: string; sku: string; parQty: number };

    if (!customerId || !sku || parQty == null) {
      return NextResponse.json({ error: "Missing customerId, sku or parQty" }, { status: 400 });
    }

    const upserted = await prisma.customerProductPar.upsert({
      where: { customerId_sku: { customerId, sku } }, // from @@unique([customerId, sku])
      create: { customerId, sku, parQty },
      update: { parQty },
    });

    return NextResponse.json({ ok: true, record: upserted });
  } catch (err: any) {
    console.error("/api/par/upsert error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
