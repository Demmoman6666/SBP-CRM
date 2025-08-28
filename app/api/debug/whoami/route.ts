// app/api/debug/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyTokenVerbose, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = url.host;
  const tok = cookies().get(COOKIE_NAME)?.value ?? null;
  const v = verifyTokenVerbose(tok);

  // prevent any proxy/browser caching
  const headers = { "Cache-Control": "no-store, max-age=0" } as const;

  if (v.ok === false) {
    const { reason } = v; // properly narrowed
    const hint =
      reason === "NoCookie"
        ? "Not signed in on this hostname. Visit /login here."
        : reason === "Expired" || reason === "BadToken"
        ? "Session cookie is invalid or expired. POST /api/auth/logout then sign in again on this hostname."
        : undefined;

    return NextResponse.json(
      { ok: false, host, hasCookie: Boolean(tok), reason, hint },
      { headers }
    );
  }

  // v.ok === true here
  const me = await prisma.user.findUnique({
    where: { id: v.payload.userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!me) {
    return NextResponse.json(
      { ok: false, host, reason: "BadPayload", detail: "User not found" },
      { headers }
    );
  }

  return NextResponse.json({ ok: true, host, me, payload: v.payload }, { headers });
}

// Optional: HEAD returns the same status as GET for quick health checks
export async function HEAD(req: Request) {
  const res = await GET(req);
  return new NextResponse(null, { status: res.status, headers: res.headers });
}
