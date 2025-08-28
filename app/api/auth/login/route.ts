// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import * as session from "@/lib/session"; // we’ll try legacy if exported

export const dynamic = "force-dynamic";

async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await req.json().catch(() => ({}));
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const obj: Record<string, any> = {};
    fd.forEach((v, k) => (obj[k] = typeof v === "string" ? v : v.name));
    return obj;
  }
  // best-effort
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const qNext = url.searchParams.get("next") || undefined;
    const body: any = await readBody(req);

    const emailRaw = (body.email ?? "").toString().trim();
    const password = (body.password ?? "").toString();
    if (!emailRaw || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: emailRaw, mode: "insensitive" } },
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

    // remember can be true/"on"/"1"
    const rememberFlag =
      body.remember === true ||
      String(body.remember || "").toLowerCase() === "on" ||
      String(body.remember || "") === "1";

    const maxAge = rememberFlag ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7; // 30d or 7d

    // Prefer legacy 2-part token if the helper exists, else fall back to the new one.
    let token: string;
    if ((session as any).createLegacyToken) {
      token = (session as any).createLegacyToken(user.id, maxAge);
    } else if ((session as any).createSessionToken) {
      token = (session as any).createSessionToken(user.id, maxAge);
    } else {
      return NextResponse.json({ error: "Auth helpers missing" }, { status: 500 });
    }

    // Prepare response (we'll decide JSON vs redirect below)
    const resJson = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      next: body.next || qNext || "/",
    });

    // Set cookie (host-only cookie on current domain)
    resJson.cookies.set("sbp_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });

    // If form submit or caller wants redirect, do a server-side redirect after setting cookie.
    const wantsRedirect =
      qNext ||
      body.next ||
      (req.headers.get("accept") || "").includes("text/html") ||
      String(body.redirect || "") === "1";

    if (wantsRedirect) {
      const dest = (body.next || qNext || "/") as string;
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
