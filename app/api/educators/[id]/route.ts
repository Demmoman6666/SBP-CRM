import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const educator = await (prisma as any).educator.update({
    where: { id: params.id },
    data: {
      name: body.name?.trim(),
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      specialisms: Array.isArray(body.specialisms) ? body.specialisms : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    },
  });
  return NextResponse.json(educator);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await (prisma as any).educator.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ ok: true });
}
