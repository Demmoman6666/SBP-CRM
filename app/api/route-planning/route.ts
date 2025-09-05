// app/api/route-planning/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCsv(param: string | null): string[] {
  if (!param) return [];
  return param
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reps = parseCsv(searchParams.get("reps"));
  const pcsRaw = parseCsv(searchParams.get("pc"));
  const limit = Math.min(Number(searchParams.get("limit") || "200"), 1000);

  // Normalise postcode prefixes (uppercased, remove spaces)
  const prefixes = pcsRaw.map(p => p.toUpperCase().replace(/\s+/g, ""));

  // Build filters
  const where: Prisma.CustomerWhereInput = {
    AND: [
      reps.length ? { salesRep: { in: reps } } : {},
      prefixes.length
        ? {
            OR: prefixes.map(p => ({
              // We keep spaces in DB values (e.g., "CF43 1AB") and match with startsWith
              postCode: { startsWith: p, mode: "insensitive" as const },
            })),
          }
        : {},
    ],
  };

  const customers = await prisma.customer.findMany({
    where,
    select: {
      id: true,
      salonName: true,
      customerName: true,
      addressLine1: true,
      addressLine2: true,
      town: true,
      county: true,
      postCode: true,
      country: true,
      customerEmailAddress: true,
      customerNumber: true,
      salesRep: true,
      createdAt: true,
    },
    orderBy: [{ postCode: "asc" }, { salonName: "asc" }],
    take: limit,
  });

  return NextResponse.json(customers);
}
