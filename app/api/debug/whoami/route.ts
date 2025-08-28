// app/api/debug/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, verifyTokenVerbose } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = url.host;
  const tok = cookies().get(COOKIE_NAME)?.value;
  const v = verifyTokenVerbose(tok);

  const headers = { "Cache-Control": "no-store, max-age=0" } as const;

  if (v.ok !== true) {
    return NextResponse.json(
      {
        ok: false,
        host,
        hasCookie: Boolean(tok),
        reason: v.reason,
        hint:
          v.reason === "NoCookie"
            ? "Not signed in on this hostname. Visit /login here."
            : v.reason === "Expired" || v.reason === "BadToken"
            ? "Session cookie is invalid or expired. POST /api/auth/logout then sign in again on this hostname."
            : undefined,
      },
      { headers }
    );
  }

  const me = await prisma.user.findUnique({
    where: { id: v.payload.userId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true, updatedAt: true },
  });

  if (!me) {
    return NextResponse.json({ ok: false, host, reason: "BadPayload", detail: "User not found" }, { headers });
  }

  return NextResponse.json({ ok: true, host, me, payload: v.payload }, { headers });
}
