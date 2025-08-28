// app/api/login/route.ts
import { NextResponse } from "next/server";

// Simple GET ping (optional)
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/login" });
}

// Re-use the same POST handler as /api/auth/login
export { POST } from "@/app/api/auth/login/route";
