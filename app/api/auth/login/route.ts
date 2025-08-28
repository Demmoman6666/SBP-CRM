// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { signToken, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await req.json().catch(() => ({}));
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const fd = await req.formData();
    return Object.fromEntries(fd.entries());
  }
  try { return await req.json(); } catch { return {}; }
}

export async function POST(req: Request) {
  try {
    const body: any = await readBody(req);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const remember = body.remember === "true" || body.remember === true;
    const next = typeof body.next === "string" ? body.next : (new URL(req.url)).searchParams.get("next") || "/";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, fullName: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 14; // 30d / 14d
    const exp = Math.floor(Date.now() / 1000) + maxAge;
    const token = signToken({ userId: user.id, exp });

    // JSON response by default
    const resJson = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, fullName: user.fullName }, next });
    setSessionCookie(resJson, token, maxAge);

    // If HTML form (or caller asked to redirect), do a server redirect and still set cookie
    const wantsRedirect =
      (req.headers.get("accept") || "").includes("text/html") ||
      body.redirect === "1" ||
      body.redirect === "true";

    if (wantsRedirect) {
      const redirect = NextResponse.redirect(new URL(next || "/", req.url), 303);
      setSessionCookie(redirect, token, maxAge);
      return redirect;
    }

    return resJson;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Login failed" }, { status: 400 });
  }
}
