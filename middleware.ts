// middleware.ts
import { NextResponse, NextRequest } from "next/server";

const COOKIE_NAME = "sbp_session";

/* ---------- utils: base64url + HMAC (Edge-safe) ---------- */
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

/* ---------- verify the exact token your login route signs ---------- */
async function verifyToken(token: string | undefined | null) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadPart, sigPart] = parts;

  const secret = process.env.AUTH_SECRET;
  if (!secret) return null; // env not configured => treat as unauthenticated

  const keyBytes = new TextEncoder().encode(secret);
  const payloadBytes = b64urlToBytes(payloadPart);
  const expected = await hmacSHA256(keyBytes, payloadBytes);
  const expectedB64url = bytesToB64url(expected);

  if (expectedB64url !== sigPart) return null;

  try {
    const json = JSON.parse(new TextDecoder().decode(payloadBytes)) as { userId: string; exp: number };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json; // { userId, exp }
  } catch {
    return null;
  }
}

/* ---------- allowlist ---------- */
const PUBLIC_EXACT = new Set<string>([
  "/login",
  "/api/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/debug/whoami",
  "/api/debug/test-login",
  "/api/debug/reset-password",
  "/favicon.ico",
  "/robots.txt",
  "/site.webmanifest",
  "/logo.svg",
]);

function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (/\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|txt|xml|css|js|map|woff2?|ttf|eot)$/i.test(pathname)) return true;
  return false;
}

/* ---------- middleware ---------- */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Always allow public assets + auth/debug routes
  if (isPublicPath(pathname)) {
    // If already signed in and visiting /login, bounce to next or /
    if (pathname === "/login") {
      const tok = req.cookies.get(COOKIE_NAME)?.value;
      const sess = await verifyToken(tok);
      if (sess) {
        const next = req.nextUrl.searchParams.get("next") || "/";
        return NextResponse.redirect(new URL(next, req.url));
      }
    }
    return NextResponse.next();
  }

  // Everything else requires a valid session
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sess = await verifyToken(token);

  if (sess) {
    return NextResponse.next();
  }

  // Unauthenticated: APIs -> 401, Pages -> redirect to /login?next=...
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = search ? `?next=${encodeURIComponent(pathname + search)}` : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

/* Protect everything by default; exclude Next internals and files with extensions. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
