// app/api/debug/test-login/route.ts
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
  let password = "";

  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await req.json().catch(() => ({}));
      email = String(j?.email ?? "").trim().toLowerCase();
      password = String(j?.password ?? "");
    } else {
      const fd = await req.formData();
      email = String(fd.get("email") ?? "").trim().toLowerCase();
      password = String(fd.get("password") ?? "");
    }
  } catch {
    /* noop */
  }

  if (!email || !password) return ok({ error: "email and password required" }, { status: 400 });

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, passwordHash: true },
  });

  if (!user) return ok({ found: false });

  // bcrypt check (what /api/auth/login uses)
  const bcryptOk = await bcrypt.compare(password, user.passwordHash);

  // pgcrypto check (optional; good sanity)
  const row =
    (await prisma.$queryRaw<
      { ok: boolean }[]
    >`SELECT crypt(${password}, "passwordHash") = "passwordHash" AS ok FROM "User" WHERE id = ${user.id} LIMIT 1;`)[0] || { ok: false };

  return ok({
    found: true,
    isActive: user.isActive,
    role: user.role,
    bcryptOk,
    pgcryptoOk: row.ok,
    hashPrefix: user.passwordHash.slice(0, 7), // e.g. "$2b$10"
  });
}

// Optional GET for quick manual testing: /api/debug/test-login?email=...&password=...&code=...
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return ok({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const password = url.searchParams.get("password") || "";
  if (!email || !password) return ok({ error: "email and password required" }, { status: 400 });
  const postReq = new NextRequest(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ email, password }),
  });
  return POST(postReq);
}
