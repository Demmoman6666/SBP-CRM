// app/api/customers/[id]/payment-terms/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_: Request, { params }: Params) {
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const c = await prisma.customer.findUnique({
      where: { id },
      select: {
        paymentDueLater: true,
        paymentTermsName: true,
        paymentTermsDueInDays: true,
      },
    });

    if (!c) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      paymentDueLater: !!c.paymentDueLater,
      paymentTermsName: c.paymentTermsName ?? null,
      paymentTermsDueInDays:
        typeof c.paymentTermsDueInDays === "number" ? c.paymentTermsDueInDays : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
