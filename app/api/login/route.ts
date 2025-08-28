// app/api/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";

// --- helpers for signing the session token (same format your middleware verifies) ---
function b64urlFromBytes(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signToken(payload: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64urlFromBytes(new Uint8Array(sig));
}

// Ping / quick health check so you can verify middleware isn’t blocking
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("ping")) {
    return NextResponse.json({ ok: true, method: "GET" });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    // Accept BOTH JSON and form posts
    const ct = req.headers.get("content-type") || "";
    let email = "";
    let password = "";

    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({} as any));
      email = String(body.email ?? "").trim();
      password = String(body.password ?? "");
    } else {
      // handles application/x-www-form-urlencoded and multipart/form-data
      const fd = await req.formData();
      email = String(fd.get("email") ?? "").trim();
      password = String(fd.get("password") ?? "");
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Look up the user and verify the bcrypt hash IN Postgres (pgcrypto)
    // ok will be true when crypt(plain, passwordHash) == passwordHash
    const rows = await prisma.$queryRaw<{
      id: string;
      fullName: string;
      email: string;
      phone: string | null;
      role: string;
      isActive: boolean;
      ok: boolean;
    }[]>`
      SELECT
        id,
        "fullName",
        "email",
        "phone",
        "role",
        "isActive",
        ("passwordHash" = crypt(${password}, "passwordHash")) AS ok
      FROM "User"
      WHERE lower("email") = lower(${email})
        AND "isActive" = true
      LIMIT 1
    `;

    if (!rows.length || !rows[0].ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = rows[0];

    // Build and sign a short token { userId, exp } that middleware validates
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
    const payload = JSON.stringify({ userId: row.id, exp });
    const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
    const payloadB64 = b64urlFromBytes(new TextEncoder().encode(payload));
    const sig = await signToken(payload, secret);
    const token = `${payloadB64}.${sig}`;

    const res = NextResponse.json({
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.fullName,
        role: row.role,
      },
    });

    // Primary cookie used by middleware
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // Legacy convenience cookie used by lib/auth.getCurrentUser()
    res.cookies.set("sbp_email", row.email.toLowerCase(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
