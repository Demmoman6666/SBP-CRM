import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/** ---- tiny auth guard (admin only) ---- */
const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64url, sigB64url] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadB64url)
    .digest("base64url");

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

async function requireAdmin() {
  const { cookies } = await import("next/headers");
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const me = await prisma.user.findUnique({
    where: { id: sess.userId },
    select: { role: true, isActive: true },
  });
  if (!me || !me.isActive || me.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

/** Type is an enum in schema: STOCKED or COMPETITOR */
type ToggleType = "STOCKED" | "COMPETITOR";

/** GET ?type=STOCKED|COMPETITOR => [{ id, name, visible }] */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") || "").toUpperCase() as ToggleType;

  if (type !== "STOCKED" && type !== "COMPETITOR") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const [brands, toggles] = await Promise.all([
    type === "STOCKED"
      ? prisma.stockedBrand.findMany({ orderBy: { name: "asc" } })
      : prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.visibilityToggle.findMany({ where: { type } }),
  ]);

  const visibleSet = new Set(toggles.filter(t => t.visible).map(t => t.brandId));
  const out = brands.map(b => ({ id: b.id, name: b.name, visible: visibleSet.has(b.id) }));
  return NextResponse.json(out);
}

/** POST { type, brandId, visible } => toggle on/off */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const type = String(body.type || "").toUpperCase() as ToggleType;
  const brandId = String(body.brandId || "");
  const visible = Boolean(body.visible);

  if ((type !== "STOCKED" && type !== "COMPETITOR") || !brandId) {
    return NextResponse.json({ error: "type and brandId are required" }, { status: 400 });
  }

  try {
    if (visible) {
      await prisma.visibilityToggle.upsert({
        where: { type_brandId: { type, brandId } },
        create: { type, brandId, visible: true },
        update: { visible: true },
      });
    } else {
      // treat table as a whitelist: remove row to hide
      await prisma.visibilityToggle.deleteMany({ where: { type, brandId } });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to update" }, { status: 400 });
  }
}
