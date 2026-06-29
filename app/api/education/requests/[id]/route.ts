import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const request = await (prisma as any).educationRequest.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, salonName: true } },
      booking: { include: { educator: true } },
    },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(request);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const updated = await (prisma as any).educationRequest.update({
    where: { id: params.id },
    data: {
      status: body.status ?? undefined,
      notes: body.notes ?? undefined,
      brands: Array.isArray(body.brands) ? body.brands : undefined,
    },
  });
  return NextResponse.json(updated);
}
