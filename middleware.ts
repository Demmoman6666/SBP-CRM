// middleware.ts
import { NextResponse, NextRequest } from "next/server";

const COOKIE_NAME = "sbp_session";

/* --- helpers --- */
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

/** ✅ Verify by HMAC’ing the *base64url payload string* (not the decoded JSON). */
async function verifyToken(token?: string | null): Promise<{ userId: string; exp: number } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const keyBytes = new TextEncoder().encode(secret);

  // IMPORTANT: sign the base64url string exactly as created by the server
  const msgBytes = new TextEncoder().encode(p);
  const expected = await hmacSHA256(keyBytes, msgBytes);
  const expectedB64 = bytesToB64url(expected);
  if (expectedB64 !== sig) return null;

  // Now safely decode and validate the payload JSON
  try {
    const payloadJson = new TextDecoder().decode(b64urlToBytes(p));
    const json = JSON.parse(payloadJson) as { userId: string; exp: number };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

/* --- public paths --- */
const PUBLIC_PATHS = [
  "/login",
  "/api/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/debug/whoami",   // keep this open for sanity checks
  "/favicon.ico",
  "/robots.txt",
  "/site.webmanifest",
  "/logo.svg",
];
const PUBLIC_FILES = /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|txt|xml|css|js|map|woff2?|ttf|eot)$/i;

function isPublicPath(pathname: string) {
  if (PUBLIC_FILES.test(pathname)) return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/assets/") || pathname.startsWith("/images/")) return true;
  if (pathname.startsWith("/api/shopify/webhooks")) return true;
  if (pathname.startsWith("/api/debug/")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) {
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

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sess = await verifyToken(token);
  if (sess) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = search ? `?next=${encodeURIComponent(pathname + search)}` : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
