// middleware.ts
import { NextResponse, NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];
const ALWAYS_ALLOW_PREFIXES = ["/_next", "/api", "/favicon.ico", "/images", "/fonts", "/__nextjs"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow framework internals, assets, and API
  if (ALWAYS_ALLOW_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Only guard HTML page navigations (GET requests for pages)
  const isPageNavigation =
    req.method === "GET" && (req.headers.get("accept")?.includes("text/html") ?? false);

  if (!isPageNavigation) {
    // Allow server actions (POST) and other non-HTML requests
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  // Simple passcode cookie check
  const authed = req.cookies.get("sbp_access")?.value;
  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // run on everything that’s not a file
  matcher: ["/((?!.*\\.).*)"],
};
