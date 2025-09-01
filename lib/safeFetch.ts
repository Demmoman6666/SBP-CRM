// lib/safefetch.ts
export async function getJsonArray<T = any>(url: string): Promise<T[]> {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "include",     // ⬅️ this sends your sbp_session cookie
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch (e) {
    console.error(`[fetch] ${url} failed`, e);
    return []; // never let the page crash
  }
}
