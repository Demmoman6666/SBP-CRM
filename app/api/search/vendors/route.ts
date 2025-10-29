import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const term = q.length >= 2 ? `%${q}%` : `%`;

    // Distinct vendors from OrderLineItem.productVendor
    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT DISTINCT "productVendor" AS name
        FROM "OrderLineItem"
        WHERE "productVendor" IS NOT NULL
          AND "productVendor" ILIKE ${term}
        ORDER BY name ASC
        LIMIT ${Prisma.raw(String(limit))}
      `
    )) as Array<{ name: string | null }>;

    const results = rows
      .map((r) => (r.name || "").trim())
      .filter((s) => s.length > 0);

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("/api/search/vendors error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
