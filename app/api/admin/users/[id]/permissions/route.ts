// app/api/admin/users/[id]/permissions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

function coerceRole(input: any): Role | undefined {
  if (!input) return undefined;
  const v = String(input).toUpperCase();
  return (Object.values(Role) as string[]).includes(v) ? (v as Role) : undefined;
}
function coercePermissions(input: any): Permission[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const valid = new Set(Object.values(Permission));
  return input
    .map((x) => String(x).toUpperCase())
    .filter((x) => valid.has(x as Permission)) as Permission[];
}

async function requireAdmin(): Promise<NextResponse | null> {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: any = {};
  const role = coerceRole(body?.role);
  const features = coercePermissions(body?.features);
  if (role) data.role = role;
  if (features) data.features = features;

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      phone: updated.phone,
      role: updated.role,
      features: updated.features,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Update failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  return PUT(req, ctx);
}
