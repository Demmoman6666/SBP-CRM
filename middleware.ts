// middleware.ts
import { NextResponse, NextRequest } from "next/server";

const COOKIE_NAME = "sbp_session";
const SECRET = process.env.AUTH_SECRET; // must be set

function b64urlToBytes(s: string) {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
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

async function verifyEdgeToken(token?: string | null) {
  if (!token || !SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;

  const expected = await hmacSHA256(new TextEncoder().encode(SECRET), b64urlToBytes(p));
  const expectedB64url = bytesToB64url(expected);
  if (expectedB64url !== sig) return null;

  try {
    const json = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as { userId: string; exp: number };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json; // { userId, exp }
  } catch {
    return null;
  }
}

/** Public routes & files */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/debug/", // keep debug tools accessible
  "/favicon.ico",
  "/robots.txt",
  "/site.webmanifest",
  "/logo.svg",
];
const PUBLIC_FILES = /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|txt|xml|css|js|map|woff2?|ttf|eot)$/i;

function isPublicPath(pathname: string) {
  if (PUBLIC_FILES.test(pathname)) return true;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/images/")) return true;
  // Shopify webhooks example:
  if (pathname.startsWith("/api/shopify/webhooks")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Allow public stuff through
  if (isPublicPath(pathname)) {
    // If already logged in and they hit /login, bounce to next/home
    if (pathname === "/login") {
      const sess = await verifyEdgeToken(req.cookies.get(COOKIE_NAME)?.value);
      if (sess) {
        const next = req.nextUrl.searchParams.get("next") || "/";
        return NextResponse.redirect(new URL(next, req.url));
      }
    }
    return NextResponse.next();
  }

  // For everything else, require a valid session
  const sess = await verifyEdgeToken(req.cookies.get(COOKIE_NAME)?.value);
  if (sess) return NextResponse.next();

  // Unauthed: APIs => 401, pages => redirect to /login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = search ? `?next=${encodeURIComponent(pathname + search)}` : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

// Protect everything except Next internals & public assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
