// app/api/settings/account/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return NextResponse.json(me);
}

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));

  const data: any = {};
  if (typeof body.fullName === "string") data.fullName = body.fullName.trim();
  if (typeof body.phone === "string") data.phone = body.phone.trim();
  if (typeof body.email === "string") data.email = body.email.trim();

  // Handle password change if supplied
  if (body.passwordChange) {
    const { currentPassword, newPassword } = body.passwordChange as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Missing password fields" }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });

    const hash = await bcrypt.hash(newPassword, 10);
    data.passwordHash = hash;
  }

  try {
    const updated = await prisma.user.update({ where: { id: me.id }, data });
    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      phone: updated.phone,
      role: updated.role,
      features: updated.features,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Update failed" }, { status: 400 });
  }
}
