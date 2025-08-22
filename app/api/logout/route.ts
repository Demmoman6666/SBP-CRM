import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set("sbp_auth", "", { path: "/", maxAge: 0 });
  return res;
}
