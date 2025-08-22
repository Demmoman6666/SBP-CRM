import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/login", "/api/logout", "/favicon.ico"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // allow public paths + static files + _next
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/assets") ||
    pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  const session = req.cookies.get("sbp_auth")?.value;
  if (session !== "1") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

