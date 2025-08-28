// app/api/settings/account/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const runtime = "nodejs"; // ensure Node runtime for bcryptjs

// Accept POST, PATCH, PUT -> all behave the same
export async function POST(req: Request) {
  return handleUpdate(req);
}
export async function PATCH(req: Request) {
  return handleUpdate(req);
}
export async function PUT(req: Request) {
  return handleUpdate(req);
}

async function handleUpdate(req: Request) {
  // Auth: read the session via our central helper (uses sbp_session)
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = me.id;

  // Parse body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = String(body.fullName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  const data: Record<string, any> = {};
  if (fullName) data.fullName = fullName;
  if (phone) data.phone = phone;
  if (email) data.email = email;

  try {
    // If changing password, verify current password first
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password required" }, { status: 400 });
      }
      const meRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!meRow) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const ok = await bcrypt.compare(currentPassword, meRow.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }
      data.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    // Prefer Prisma error code for unique constraint
    if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("email")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 400 });
    }
    const msg = typeof e?.message === "string" ? e.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
