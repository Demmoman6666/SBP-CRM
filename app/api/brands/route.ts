// app/api/brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64url, sigB64url] = parts;
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto.createHmac("sha256", secret).update(payloadB64url).digest("base64url");
  if (expected !== sigB64url) return null;
  try {
    const json = JSON.parse(Buffer.from(payloadB64url, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}
async function requireUser() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: sess.userId }, select: { role: true, isActive: true } });
  if (!user || !user.isActive) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}
async function requireAdmin() {
  const g = await requireUser();
  if ("error" in g) return g;
  if (g.user.role !== "ADMIN") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return g;
}
async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return req.json().catch(() => ({}));
  if (ct.includes("form")) {
    const fd = await req.formData();
    const o: Record<string, any> = {};
    fd.forEach((v, k) => (o[k] = typeof v === "string" ? v : String(v)));
    return o;
  }
  return {};
}

/* GET: list brands (id, name, visibleInCallLog) */
export async function GET() {
  const g = await requireUser();
  if ("error" in g) return g.error;

  const list = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibleInCallLog: true },
  });
  return NextResponse.json(list);
}

/* POST: create one competitor brand { name } */
export async function POST(req: Request) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const body = await readBody(req);
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const created = await prisma.brand.create({
      data: { name },
      select: { id: true, name: true, visibleInCallLog: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "Brand already exists" }, { status: 409 });
    return NextResponse.json({ error: e?.message || "Create failed" }, { status: 400 });
  }
}

/* PATCH: toggle visibility { id, visible } */
export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const body = await readBody(req);
  const id = String(body?.id || "");
  const visible = body?.visible;
  if (!id || typeof visible !== "boolean") {
    return NextResponse.json({ error: "id and visible are required" }, { status: 400 });
  }
  try {
    const updated = await prisma.brand.update({
      where: { id },
      data: { visibleInCallLog: visible },
      select: { id: true, name: true, visibleInCallLog: true },
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 400 });
  }
}

/* DELETE: ?id=... */
export async function DELETE(req: Request) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await prisma.brand.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 400 });
  }
}
