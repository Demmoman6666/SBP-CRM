import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const form = await req.formData();
  const code = String(form.get("code") || "");
  if (!process.env.ACCESS_CODE) {
    return new NextResponse("ACCESS_CODE not configured", { status: 500 });
  }
  if (code !== process.env.ACCESS_CODE) {
    return new NextResponse("Invalid code", { status: 401 });
  }
  const res = NextResponse.redirect(new URL("/", req.url));
  // super simple session cookie
  res.cookies.set("sbp_auth", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 8 // 8 hours
  });
  return res;
}
