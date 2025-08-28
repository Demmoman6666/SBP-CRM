// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";
const SECRET = process.env.AUTH_SECRET; // must be set in Vercel (Preview & Production)

/* ---------- helpers ---------- */
function base64url(input: string | Uint8Array) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signToken(payloadJson: string) {
  if (!SECRET) {
    throw new Error("AUTH_SECRET is not set");
  }
  const sig = crypto.createHmac("sha256", SECRET).update(payloadJson).digest();
  return `${base64url(payloadJson)}.${base64url(sig)}`; // 2-part payload.sig (matches middleware)
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Record<string, any>;
  }
  const fd = await req.formData();
  return Object.fromEntries(fd.entries()) as Record<string, any>;
}

function setSessionCookie(res: NextResponse, token: string, maxAge: number) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

/* ---------- POST /api/auth/login ---------- */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);

    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const remember = String(body.remember ?? "true") === "true"; // default remember
    const next = String(body.next ?? "");
    const wantsRedirect =
      String(body.redirect ?? "") === "1" ||
      (req.headers.get("accept") || "").includes("text/html");

    if (!SECRET) {
      return NextResponse.json({ error: "Auth helpers missing" }, { status: 500 });
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Look up user (case-insensitive) and check bcrypt hash
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7; // 30d or 7d
    const payload = { userId: user.id, exp: Math.floor(Date.now() / 1000) + maxAge };
    const token = signToken(JSON.stringify(payload));

    // If it's a form submit or caller wants a redirect, set cookie then 303 redirect.
    if (wantsRedirect) {
      const dest = new URL(next || "/", req.url);
      const redirect = NextResponse.redirect(dest, 303);
      setSessionCookie(redirect, token, maxAge);
      return redirect;
    }

    // Otherwise return JSON and set the cookie.
    const resJson = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });
    setSessionCookie(resJson, token, maxAge);
    return resJson;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Login failed" }, { status: 400 });
  }
}
