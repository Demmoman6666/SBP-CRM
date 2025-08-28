// app/api/debug/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function verifyTokenVerbose(token?: string | null):
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "NoCookie" | "BadFormat" | "BadToken" | "Expired" } {
  if (!token) return { ok: false, reason: "NoCookie" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "BadFormat" };
  const [p, sig] = parts;
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto.createHmac("sha256", secret).update(p).digest("base64url");
  if (expected !== sig) return { ok: false, reason: "BadToken" };
  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return { ok: false, reason: "BadFormat" };
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "Expired" };
    return { ok: true, payload: json };
  } catch {
    return { ok: false, reason: "BadFormat" };
  }
}

export async function GET() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const v = verifyTokenVerbose(tok);

  if (!v.ok) {
    return NextResponse.json({ ok: false, reason: v.reason });
  }

  const me = await prisma.user.findUnique({
    where: { id: v.payload.userId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });

  return NextResponse.json({ ok: true, payload: v.payload, me });
}
