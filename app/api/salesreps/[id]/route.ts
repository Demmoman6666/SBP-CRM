// app/api/salesreps/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!isAdmin(me)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const { name, email, phone, territory, cycleStartDate } = await req.json();
    if (name !== undefined && !String(name).trim()) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    const rep = await prisma.salesRep.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(email !== undefined ? { email: email ? String(email).trim() : null } : {}),
        ...(phone !== undefined ? { phone: phone ? String(phone).trim() : null } : {}),
        ...(territory !== undefined ? { territory: territory ? String(territory).trim() : null } : {}),
        ...(cycleStartDate !== undefined ? { cycleStartDate: cycleStartDate ? new Date(cycleStartDate) : null } : {}),
      },
    });
    return NextResponse.json(rep);
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "A rep with that name already exists" }, { status: 409 });
    if (e?.code === "P2025") return NextResponse.json({ error: "Rep not found" }, { status: 404 });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!isAdmin(me)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    await prisma.salesRep.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2025") return NextResponse.json({ error: "Rep not found" }, { status: 404 });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
