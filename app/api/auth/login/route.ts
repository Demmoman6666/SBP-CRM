// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await req.json() : Object.fromEntries(await req.formData());

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const remember = body.remember === true || String(body.remember || "").toLowerCase() === "true";
    const next = typeof body.next === "string" ? body.next : undefined;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, fullName: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;
    const token = createSessionToken(user.id, maxAge);

    // Default JSON response
    const resJson = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      next: next || "/",
    });
    resJson.cookies.set("sbp_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });

    // If they posted a normal form or want a redirect, do a server redirect after setting the cookie
    const accept = (req.headers.get("accept") || "").toLowerCase();
    const wantsRedirect =
      (typeof next === "string" && next.startsWith("/")) ||
      accept.includes("text/html") ||
      String(body.redirect || "").toLowerCase() === "1";

    if (wantsRedirect) {
      const dest = (next && next.startsWith("/")) ? next : "/";
      const redirect = NextResponse.redirect(new URL(dest, req.url), 303);
      redirect.cookies.set("sbp_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge,
      });
      return redirect;
    }

    return resJson;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Login failed" }, { status: 400 });
  }
}
