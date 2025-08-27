// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<NextResponse | null> {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

function coerceRole(input: any): Role {
  const v = String(input || "").toUpperCase();
  return (Object.values(Role) as string[]).includes(v) ? (v as Role) : "STAFF";
}
function coercePermissions(input: any): Permission[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set(Object.values(Permission));
  return input
    .map((x) => String(x).toUpperCase())
    .filter((x) => valid.has(x as Permission)) as Permission[];
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
      name: u.name,
      phone: u.phone,
      role: u.role,
      features: u.features,
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
  const name = String(body?.name || "").trim();
  const phone = body?.phone ? String(body.phone).trim() : null;
  const role = coerceRole(body?.role);
  const features = coercePermissions(body?.features);
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
        name: name || null,
        phone,
        role,
        features,
        passwordHash,
      },
    });

    return NextResponse.json(
      {
        id: created.id,
        email: created.email,
        name: created.name,
        phone: created.phone,
        role: created.role,
        features: created.features,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      { status: 201 }
    );
  } catch (e: any) {
    if (String(e?.message || "").includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A user with that email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: e?.message || "Create failed" },
      { status: 400 }
    );
  }
}
