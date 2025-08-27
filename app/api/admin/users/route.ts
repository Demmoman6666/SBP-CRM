// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null as const;
}

function coerceRole(input: any): Role {
  const v = String(input || "").toUpperCase();
  return (Object.values(Role) as string[]).includes(v) ? (v as Role) : "STAFF";
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }))
  );
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const fullName =
    String(body?.fullName || body?.name || "").trim() || null; // accept `name` too
  const phone = body?.phone ? String(body.phone).trim() : null;
  const role = coerceRole(body?.role);
  const password = String(body?.password || "").trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  try {
    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        email,
        fullName,
        phone,
        role,
        passwordHash,
        isActive: true,
      },
    });

    return NextResponse.json(
      {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
        phone: created.phone,
        role: created.role,
        isActive: created.isActive,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      { status: 201 }
    );
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A user with that email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg || "Create failed" }, { status: 400 });
  }
}
