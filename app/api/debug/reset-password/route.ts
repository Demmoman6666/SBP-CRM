// app/api/debug/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const ACCESS_CODE = process.env.ACCESS_CODE || "";

function ok(res: any, init: any = {}) {
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" }, ...init });
}

function isAuthorized(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get("code") || "";
  const h = req.headers.get("x-access-code") || "";
  return ACCESS_CODE && (q === ACCESS_CODE || h === ACCESS_CODE);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return ok({ error: "Forbidden" }, { status: 403 });

  let email = "";
  let userId = "";
  let newPassword = "";

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    email = String(j?.email ?? "").trim().toLowerCase();
    userId = String(j?.userId ?? "");
    newPassword = String(j?.newPassword ?? "");
  } else {
    const fd = await req.formData();
    email = String(fd.get("email") ?? "").trim().toLowerCase();
    userId = String(fd.get("userId") ?? "");
    newPassword = String(fd.get("newPassword") ?? "");
  }

  if (!newPassword || newPassword.length < 8) {
    return ok({ error: "newPassword must be at least 8 chars" }, { status: 400 });
  }

  const user =
    userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  if (!user) return ok({ error: "User not found" }, { status: 404 });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  return ok({ ok: true, id: user.id, email: user.email });
}
