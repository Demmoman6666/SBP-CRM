import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strict comma-split for reps (names can contain spaces)
function parseCommaList(param: string | null): string[] {
  if (!param) return [];
  return param.split(",").map(s => s.trim()).filter(Boolean);
}

// Flexible split for postcode prefixes (commas or whitespace)
function parsePrefixes(param: string | null): string[] {
  if (!param) return [];
  return param.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const reps = parseCommaList(searchParams.get("reps"));
  const prefixes = parsePrefixes(searchParams.get("pc"))
    .map(p => p.toUpperCase().replace(/\s+/g, ""));

  const limit = Math.min(Number(searchParams.get("limit") || "200"), 1000);

  const repFilter: Prisma.CustomerWhereInput =
    reps.length
      ? {
          OR: reps.map(r => ({
            salesRep: { equals: r, mode: "insensitive" },
          })),
        }
      : {};

  const pcFilter: Prisma.CustomerWhereInput =
    prefixes.length
      ? {
          OR: prefixes.map(p => ({
            postCode: { startsWith: p, mode: "insensitive" },
          })),
        }
      : {};

  const where: Prisma.CustomerWhereInput = { AND: [repFilter, pcFilter] };

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
