// app/api/route-planning/route.ts
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

const VALID_DAYS = new Set(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // filters from query
  const reps = parseCommaList(searchParams.get("reps"));
  const prefixes = parsePrefixes(searchParams.get("pc")).map(p => p.toUpperCase().replace(/\s+/g, ""));

  const onlyPlanned = searchParams.get("onlyPlanned") === "1";
  const weekRaw = Number(searchParams.get("week") || "");
  const week = Number.isInteger(weekRaw) && weekRaw >= 1 && weekRaw <= 4 ? weekRaw : null;

  const dayRaw = (searchParams.get("day") || "").trim().toUpperCase();
  const day = VALID_DAYS.has(dayRaw) ? dayRaw : null;

  const limit = Math.min(Math.max(Number(searchParams.get("limit") || "200"), 1), 1000);

  const andFilters: Prisma.CustomerWhereInput[] = [];

  // reps: case-insensitive equals
  if (reps.length) {
    andFilters.push({
      OR: reps.map(r => ({ salesRep: { equals: r, mode: "insensitive" } })),
    });
  }

  // postcode prefixes: case-insensitive startsWith
  if (prefixes.length) {
    andFilters.push({
      OR: prefixes.map(p => ({ postCode: { startsWith: p, mode: "insensitive" } })),
    });
  }

  // route plan filters
  if (onlyPlanned || week || day) {
    andFilters.push({ routePlanEnabled: true });
  }
  if (week) {
    andFilters.push({ routeWeeks: { has: week } });
  }
  if (day) {
    andFilters.push({ routeDays: { has: day as any } }); // enum RouteDay
  }

  const where: Prisma.CustomerWhereInput = andFilters.length ? { AND: andFilters } : {};

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
      // helpful if the UI wants to show what was selected
      routePlanEnabled: true,
      routeWeeks: true,
      routeDays: true,
    },
    orderBy: [{ postCode: "asc" }, { salonName: "asc" }],
    take: limit,
  });

  return NextResponse.json(customers);
}
