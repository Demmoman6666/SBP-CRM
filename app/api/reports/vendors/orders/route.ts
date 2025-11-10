import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma"; // or your DB util
// import { addDays, parseISO } from "date-fns";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const vendor = searchParams.get("vendor") || undefined;
  const start  = searchParams.get("start");
  const end    = searchParams.get("end");

  // TODO: Replace with your real query.
  // Example shape the frontend expects:
  // [{ id, number, date, customerName, total, salesRep }]
  const rows = [] as any[];

  return NextResponse.json({ rows });
}
