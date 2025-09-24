// lib/linnworks.ts
type LWSession = { token: string; base: string; fetchedAt: number };
let cache: LWSession | null = null;

function toBase(server: string) {
  const s = server?.trim();
  if (!s) return "";
  // If server already has protocol, keep it; otherwise prefix https://
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  // Strip trailing slashes
  return withProto.replace(/\/+$/, "");
}

export async function getLW(): Promise<LWSession> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < 25 * 60 * 1000) return cache;

  const r = await fetch("https://api.linnworks.net/api/Auth/AuthorizeByApplication", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      ApplicationId: process.env.LINNWORKS_APP_ID,
      ApplicationSecret: process.env.LINNWORKS_APP_SECRET,
      Token: process.env.LINNWORKS_INSTALL_TOKEN,
    }),
    cache: "no-store",
  });

  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok || !json?.Token || !json?.Server) {
    throw new Error(`Linnworks auth failed (${r.status}): ${text || "no body"}`);
  }

  cache = { token: json.Token, base: toBase(json.Server), fetchedAt: now };
  return cache!;
}
