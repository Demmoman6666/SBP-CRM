// middleware.ts
import { NextResponse, NextRequest } from "next/server";

/** Auth cookie name (must match server) */
const COOKIE_NAME = "sbp_session";

/* ---------------- WebCrypto helpers ---------------- */
function b64urlEncode(bytes: Uint8Array) {
  // base64url (no padding)
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa expects latin1
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecodeToBytes(s: string) {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "====".slice(norm.length % 4) : "";
  const bin = atob(norm + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function hmacSHA256_base64url(messageAscii: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(messageAscii));
  return b64urlEncode(new Uint8Array(sig));
}

/* ------------------------------------------------------------------
   verifyTokenCompatEdge
   Accepts BOTH:
   - legacy 2-part: payload.sig        (HMAC over the *payload string*, base64url)
   - JWT 3-part:    header.payload.sig (HMAC over the ASCII "header.payload")
------------------------------------------------------------------- */
async function verifyTokenCompatEdge(
  token?: string | null
): Promise<{ userId: string; exp: number } | null> {
  if (!token) return null;

  const parts = token.split(".");
  let payloadPart = "";
  let providedSig = "";
  let toSign = "";

  if (parts.length === 2) {
    // legacy: payload.sig  (server signs the BASE64URL payload string)
    [payloadPart, providedSig] = parts;
    toSign = payloadPart;
  } else if (parts.length === 3) {
    // JWT: header.payload.sig  (server signs the ASCII `${header}.${payload}`)
    const [h, p, s] = parts;
    payloadPart = p;
    providedSig = s;
    toSign = `${h}.${p}`;
  } else {
    return null;
  }

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expectedSig = await hmacSHA256_base64url(toSign, secret);
  if (providedSig.replace(/=+$/g, "") !== expectedSig) return null;

  // Parse payload JSON
  try {
    const bytes = b64urlDecodeToBytes(payloadPart);
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { userId: string; exp: number };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Public routes (exact paths)
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/favicon.ico",
  "/robots.txt",
  "/site.webmanifest",
  "/logo.svg",
];

/** Public file extensions */
const PUBLIC_FILES = /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|txt|xml|css|js|map|woff2?|ttf|eot)$/i;

/** Which paths bypass auth entirely */
function isPublicPath(pathname: string) {
  if (PUBLIC_FILES.test(pathname)) return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/images/")) return true;

  // keep Shopify webhooks unauthenticated
  if (pathname.startsWith("/api/shopify/webhooks")) return true;

  // keep debug tools open (optional)
  if (pathname.startsWith("/api/debug/")) return true;

  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Allow public assets/routes
  if (isPublicPath(pathname)) {
    // If a logged-in user hits /login, bounce to next or home
    if (pathname === "/login") {
      const tok = req.cookies.get(COOKIE_NAME)?.value;
      const ok = await verifyTokenCompatEdge(tok);
      if (ok) {
        const next = req.nextUrl.searchParams.get("next") || "/";
        return NextResponse.redirect(new URL(next, req.url));
      }
    }
    return NextResponse.next();
  }

  // Verify session for everything else
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sess = await verifyTokenCompatEdge(token);
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

/** Protect everything by default, excluding Next internals and any file with an extension */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
