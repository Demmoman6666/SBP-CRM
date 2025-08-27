// app/api/admin/users/[id]/permissions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

/* Coerce any input to a valid Role enum (or undefined) */
function coerceRole(input: any): Role | undefined {
  if (!input) return undefined;
  const v = String(input).toUpperCase();
  return (Object.values(Role) as string[]).includes(v) ? (v as Role) : undefined;
}

/* Admin guard */
async function requireAdmin(): Promise<NextResponse | null> {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
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
  if (role) data.role = role;

  if (typeof body?.isActive === "boolean") {
    data.isActive = body.isActive;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
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
    return NextResponse.json(
      { error: e?.message || "Update failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: { id: string } }
) {
  return PUT(req, ctx);
}
