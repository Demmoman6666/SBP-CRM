// middleware.ts
import { NextResponse, NextRequest } from "next/server";

/**
 * Edge-safe verification (Web Crypto). Must mirror the server logic from lib/auth.
 */
const COOKIE_NAME = "sbp_session";

function b64urlToBytes(s: string) {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "====".slice(norm.length % 4) : "";
  const bin = atob(norm + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64url(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmacSHA256(keyBytes: Uint8Array, msgBytes: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}
async function verifyToken(token: string | undefined | null): Promise<{ userId: string; exp: number } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const keyBytes = new TextEncoder().encode(secret);
  const payloadBytes = b64urlToBytes(p);
  const expected = await hmacSHA256(keyBytes, payloadBytes);
  const expectedB64 = bytesToB64url(expected);
  if (expectedB64 !== sig) return null;

  try {
    const json = JSON.parse(new TextDecoder().decode(payloadBytes)) as { userId: string; exp: number };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

const PUBLIC_PATHS = [
  "/login",
  "/api/login",        // 👈 add this so the login POST is allowed
  "/api/auth/login",   // (kept in case you also expose this path)
  "/api/auth/logout",
  "/favicon.ico",
];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;  // Next assets
  if (pathname.startsWith("/assets/")) return true; // your static
  if (pathname.startsWith("/images/")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // allow public assets/routes
  if (isPublicPath(pathname)) {
    // If logged-in user hits /login, bounce them to next or home
    if (pathname === "/login") {
      const tok = req.cookies.get(COOKIE_NAME)?.value;
      const ok = await verifyToken(tok);
      if (ok) {
        const next = req.nextUrl.searchParams.get("next") || "/";
        return NextResponse.redirect(new URL(next, req.url));
      }
    }
    return NextResponse.next();
  }

  // Verify session for everything else
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sess = await verifyToken(token);
  if (sess) return NextResponse.next();

  // Unauthenticated: page → redirect to /login, API → 401
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = search ? `?next=${encodeURIComponent(pathname + search)}` : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

// Protect everything by default; the isPublicPath above handles exclusions.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
