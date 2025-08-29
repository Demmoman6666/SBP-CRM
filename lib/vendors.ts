// lib/vendors.ts
export async function fetchVendorNames(): Promise<string[]> {
  const url = `/api/vendors?ts=${Date.now()}`; // cache-buster
  const res = await fetch(url, { cache: "no-store", credentials: "include" });
  const j = await res.json().catch(() => null);

  // Accept plain array or { names } or { vendors }
  if (Array.isArray(j)) return j as string[];
  if (Array.isArray(j?.names)) return j.names as string[];
  if (Array.isArray(j?.vendors)) return (j.vendors as any[]).map((v) => String(v.name ?? "")).filter(Boolean);
  return [];
}
