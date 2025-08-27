// app/api/admin/users/[id]/permissions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(_: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await _.json().catch(() => ({} as any));
  const data: any = {};
  if (body.role === "USER" || body.role === "ADMIN") data.role = body.role;
  if (body.features && typeof body.features === "object") data.features = body.features;

  try {
    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: { id: true, email: true, role: true, features: true },
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Update failed" }, { status: 400 });
  }
}
