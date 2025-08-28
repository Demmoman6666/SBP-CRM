// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { signToken, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

/* ---- helpers ---- */
function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "on" || s === "yes";
  }
  return false;
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await req.json();
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const fd = await req.formData();
    return Object.fromEntries(fd.entries());
  }
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/* ---- POST /api/auth/login ---- */
export async function POST(req: NextRequest) {
  const body: any = await readBody(req);

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const remember = asBool(body.remember);

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  // case-insensitive lookup (email is unique in your schema)
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 30 days if "remember", otherwise 7 days
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;
  const exp = Math.floor(Date.now() / 1000) + maxAge;

  // Sign using the same secret/format as all verifiers
  const token = signToken({ userId: user.id, exp });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, fullName: user.fullName },
    remember,
  });

  // Host-only cookie (no domain), httpOnly, lax, secure on prod
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge, // seconds
  });

  return res;
}
