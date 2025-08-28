// app/api/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// helper: base64url
function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// mint sbp_session token compatible with middleware.ts (payload.signature)
function createSessionToken(userId: string, days = 30) {
  const exp = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const payload = { userId, exp };
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(p).digest());
  return { token: `${p}.${sig}`, exp };
}

type Row = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: "ADMIN" | "MANAGER" | "REP" | "VIEWER";
  isActive: boolean;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("ping") === "1") {
    return NextResponse.json({ ok: true, method: "GET" });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json().catch(() => ({} as any));
    const e = String(email || "").trim();
    const p = String(password || "");
    if (!e || !p) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Verify with pgcrypto (bcrypt) in SQL so it matches your Neon hash
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, "fullName", email, phone, role, "isActive"
      FROM "User"
      WHERE lower(email) = lower(${e})
        AND "isActive" = true
        AND "passwordHash" = crypt(${p}, "passwordHash")
      LIMIT 1
    `;
    if (!rows.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = rows[0];
    const lowerEmail = user.email.toLowerCase();

    // mint session token for middleware
    const { token } = createSessionToken(user.id);

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });

    // primary cookie for middleware
    res.cookies.set("sbp_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // backward-compat for server helpers that read email
    res.cookies.set("sbp_email", lowerEmail, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.set("email", lowerEmail, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
