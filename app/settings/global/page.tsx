// app/settings/global/page.tsx
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "sbp_session";
type Token = { userId: string; exp: number };

function verifyToken(token?: string | null): Token | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto.createHmac("sha256", secret).update(p).digest("base64url");
  if (expected !== sig) return null;
  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as Token;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

async function requireAdmin() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return null;
  const me = await prisma.user.findUnique({ where: { id: sess.userId }, select: { role: true } });
  return me?.role === "ADMIN" ? sess.userId : null;
}

export const dynamic = "force-dynamic";

export default async function GlobalSettingsPage() {
  const me = await requireAdmin();
  if (!me) {
    return (
      <div className="card">
        <h2>Global Settings</h2>
        <p className="small">You need admin access to edit global settings.</p>
      </div>
    );
  }

  // Load all brands
  const [stocked, competitors] = await Promise.all([
    prisma.stockedBrand.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  // --- Server Actions ---
  async function saveStockedVisibility(formData: FormData) {
    "use server";
    const checked = new Set<string>(formData.getAll("stocked[]").map(String));
    await prisma.$transaction([
      prisma.stockedBrand.updateMany({ data: { visibleInCallLog: false }, where: {} }),
      prisma.stockedBrand.updateMany({ data: { visibleInCallLog: true }, where: { id: { in: [...checked] } } }),
    ]);
  }
  async function saveCompetitorVisibility(formData: FormData) {
    "use server";
    const checked = new Set<string>(formData.getAll("competitors[]").map(String));
    await prisma.$transaction([
      prisma.brand.updateMany({ data: { visibleInCallLog: false }, where: {} }),
      prisma.brand.updateMany({ data: { visibleInCallLog: true }, where: { id: { in: [...checked] } } }),
    ]);
  }

  async function addSalesRep(formData: FormData) {
    "use server";
    const name = String(formData.get("rep_name") || "").trim();
    const email = String(formData.get("rep_email") || "").trim() || null;
    if (!name) return;
    await prisma.salesRep.create({ data: { name, email } });
  }
  async function addCompetitorBrand(formData: FormData) {
    "use server";
    const name = String(formData.get("brand_name") || "").trim();
    if (!name) return;
    await prisma.brand.create({ data: { name } });
  }
  async function addStockedBrand(formData: FormData) {
    "use server";
    const name = String(formData.get("stocked_name") || "").trim();
    if (!name) return;
    await prisma.stockedBrand.create({ data: { name } });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>Global Settings</h2>
        <p className="small muted">Toggle which brands appear as checkboxes on the Log Call form.</p>
        <div className="grid grid-2" style={{ gap: 16, marginTop: 12 }}>
          {/* Toggle Stocked Brands */}
          <form action={saveStockedVisibility} className="card" style={{ padding: 12 }}>
            <h3>Toggle Stocked Brands</h3>
            <div className="grid" style={{ gap: 6, marginTop: 8, maxHeight: 320, overflow: "auto" }}>
              {stocked.map((b) => (
                <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="stocked[]" defaultChecked={b.visibleInCallLog} value={b.id} />
                  <span>{b.name}</span>
                </label>
              ))}
              {stocked.length === 0 && <div className="small muted">No stocked brands yet.</div>}
            </div>
            <div className="right" style={{ marginTop: 10 }}>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>

          {/* Toggle Competitor Brands */}
          <form action={saveCompetitorVisibility} className="card" style={{ padding: 12 }}>
            <h3>Toggle Competitor Brands</h3>
            <div className="grid" style={{ gap: 6, marginTop: 8, maxHeight: 320, overflow: "auto" }}>
              {competitors.map((b) => (
                <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="competitors[]" defaultChecked={b.visibleInCallLog} value={b.id} />
                  <span>{b.name}</span>
                </label>
              ))}
              {competitors.length === 0 && <div className="small muted">No competitor brands yet.</div>}
            </div>
            <div className="right" style={{ marginTop: 10 }}>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>
        </div>
      </div>

      {/* Quick Add section (moved here, admin only) */}
      <div className="card">
        <h3>Quick Add</h3>
        <div className="grid grid-3" style={{ gap: 12 }}>
          <form action={addSalesRep} className="grid" style={{ gap: 6 }}>
            <b>Add a Sales Rep</b>
            <input name="rep_name" placeholder="Name*" required />
            <input name="rep_email" type="email" placeholder="Email (optional)" />
            <button className="primary" type="submit">Save Rep</button>
          </form>

          <form action={addCompetitorBrand} className="grid" style={{ gap: 6 }}>
            <b>Add a Competitor Brand</b>
            <input name="brand_name" placeholder="Brand name*" required />
            <button className="primary" type="submit">Save Competitor Brand</button>
          </form>

          <form action={addStockedBrand} className="grid" style={{ gap: 6 }}>
            <b>Add a Stocked Brand</b>
            <input name="stocked_name" placeholder="Brand name*" required />
            <button className="primary" type="submit">Save Stocked Brand</button>
          </form>
        </div>
      </div>
    </div>
  );
}
