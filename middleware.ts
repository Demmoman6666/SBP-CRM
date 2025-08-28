// middleware.ts
import { NextResponse, NextRequest } from "next/server";

/** Cookie name shared across app */
const COOKIE_NAME = "sbp_session";

/* ---------------- Base64URL + HMAC helpers (Edge-safe) ---------------- */
function toB64url(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa is available in the Edge runtime
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(s: string) {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "====".slice(norm.length % 4) : "";
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacSHA256_str(secret: string, msg: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}
function canon(sig: string) {
  // normalize any base64/base64url signature to url-safe, no padding
  return sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* ---------------- Token verification (2-part OR 3-part) ----------------
   - 2-part:  payload.sig               (legacy)
   - 3-part:  header.payload.sig        (JWT-style)
------------------------------------------------------------------------- */
async function verifyTokenCompat(token?: string | null): Promise<{ userId: string; exp: number } | null> {
  if (!token) return null;

  const parts = token.split(".");
  let payloadPart = "";
  let providedSig = "";
  let toSign = "";

  if (parts.length === 2) {
    [payloadPart, providedSig] = parts;     // HMAC over payload
    toSign = payloadPart;
  } else if (parts.length === 3) {
    const [headerPart, p, s] = parts;       // HMAC over header.payload
    payloadPart = p;
    providedSig = s;
    toSign = `${headerPart}.${payloadPart}`;
  } else {
    return null;
  }

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = toB64url(await hmacSHA256_str(secret, toSign));
  if (canon(providedSig) !== expected) return null;

  try {
    const json = JSON.parse(new TextDecoder().decode(fromB64url(payloadPart))) as { userId: string; exp: number };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

/* ---------------- Public paths & assets ---------------- */
const PUBLIC_PATHS = [
  "/login",
  "/api/login",          // legacy
  "/api/auth/login",
  "/api/auth/logout",
  "/favicon.ico",
  "/robots.txt",
  "/site.webmanifest",
  "/logo.svg",
];

const PUBLIC_FILES = /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|txt|xml|css|js|map|woff2?|ttf|eot)$/i;

function isPublicPath(pathname: string) {
  if (PUBLIC_FILES.test(pathname)) return true;     // any static asset
  if (PUBLIC_PATHS.includes(pathname)) return true; // exact
  if (pathname.startsWith("/_next/")) return true;  // Next internals
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/images/")) return true;

  // Webhooks should bypass auth
  if (pathname.startsWith("/api/shopify/webhooks")) return true;

  // Optional: keep debug tools open
  if (pathname.startsWith("/api/debug/")) return true;

  return false;
}

/* ---------------- Middleware ---------------- */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Allow public assets/routes
  if (isPublicPath(pathname)) {
    // If a logged-in user hits /login, bounce them to next or home
    if (pathname === "/login") {
      const tok = req.cookies.get(COOKIE_NAME)?.value;
      const sess = await verifyTokenCompat(tok);
      if (sess) {
        const next = req.nextUrl.searchParams.get("next") || "/";
        return NextResponse.redirect(new URL(next, req.url));
      }
    }
    return NextResponse.next();
  }

  // Verify session for everything else
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sess = await verifyTokenCompat(token);
  if (sess) return NextResponse.next();

  // Unauthenticated: APIs -> 401 JSON, Pages -> redirect to /login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = search
    ? `?next=${encodeURIComponent(pathname + search)}`
    : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

/* ---------------- Matcher ----------------
   Protect everything by default; exclude Next internals
   and any request for a file (has a dot in the last path segment).
------------------------------------------- */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
