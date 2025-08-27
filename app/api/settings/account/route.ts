// app/api/settings/account/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

/** GET /api/settings/account
 *  Returns the current user's profile (safe fields only)
 */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

/** PUT /api/settings/account
 *  Body (any subset): { fullName?, phone?, email?, currentPassword?, newPassword? }
 *  - If changing password, currentPassword is required and must match.
 */
export async function PUT(req: Request) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = (body?.fullName ?? "").toString().trim();
  const phone = (body?.phone ?? "").toString().trim();
  const email = (body?.email ?? "").toString().trim().toLowerCase();
  const currentPassword = (body?.currentPassword ?? "").toString();
  const newPassword = (body?.newPassword ?? "").toString();

  const updateData: {
    fullName?: string;
    phone?: string | null;
    email?: string;
    passwordHash?: string;
  } = {};

  if (fullName) updateData.fullName = fullName;
  if (phone || phone === "") updateData.phone = phone || null;
  if (email) updateData.email = email;

  // If changing password, require current password and verify
  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required to set a new password" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { id: me.id },
      select: { passwordHash: true },
    });
    if (!existing?.passwordHash) {
      return NextResponse.json(
        { error: "Password cannot be changed for this account" },
        { status: 400 }
      );
    }
    const ok = await bcrypt.compare(currentPassword, existing.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    updateData.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    // Handle unique email violation
    if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("email")) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 400 });
    }
    return NextResponse.json({ error: e?.message ?? "Update failed" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  // Alias to PUT for convenience
  return PUT(req);
}
