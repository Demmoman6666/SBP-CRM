// app/api/route-planning/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------- helpers --------

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

// Accept Mon,Tue,Wed,Thu,Fri,Sat,Sun OR full names (case-insensitive)
const DOW_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] as const;
type DowShort = typeof DOW_SHORT[number];

function normDayToken(s: string): DowShort | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  // map full names -> short
  if (t.startsWith("mon")) return "Mon";
  if (t.startsWith("tue")) return "Tue";
  if (t.startsWith("wed")) return "Wed";
  if (t.startsWith("thu")) return "Thu";
  if (t.startsWith("fri")) return "Fri";
  if (t.startsWith("sat")) return "Sat";
  if (t.startsWith("sun")) return "Sun";
  return null;
}

function parseDays(param: string | null): DowShort[] {
  if (!param) return [];
  const out: DowShort[] = [];
  for (const raw of param.split(/[,\s]+/)) {
    const n = normDayToken(raw);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// Parse openingHours JSON string into a Set of days that are open
// Expected shape per your UI: { Mon: { open: true, from?: "...", to?: "..." }, ... }
function openDaysFromOpeningHours(src?: string | null): Set<DowShort> {
  const set = new Set<DowShort>();
  if (!src) return set;
  try {
    const obj = JSON.parse(src);
    if (obj && typeof obj === "object") {
      for (const d of DOW_SHORT) {
        const it = (obj as any)[d];
        if (it && typeof it === "object" && it.open === true) set.add(d);
      }
    }
  } catch {
    // ignore bad JSON
  }
  return set;
}

// Tokenize Customer.daysOpen CSV like "Mon,Tue,Fri"
function tokensFromDaysOpen(csv?: string | null): Set<DowShort> {
  const set = new Set<DowShort>();
  if (!csv) return set;
  for (const raw of csv.split(/[,\s]+/)) {
    const n = normDayToken(raw);
    if (n) set.add(n);
  }
  return set;
}

// -------- main --------

// Valid route-planning days (for routeDays enum) — Monday..Friday only, per your schema
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

  // NEW: days open (Mon,Tue,...)
  const daysOpenFilter = parseDays(searchParams.get("days"));

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

  // SQL-level prefilter for days open via Customer.daysOpen CSV (fast, ANY match)
  if (daysOpenFilter.length) {
    andFilters.push({
      OR: daysOpenFilter.map(d => ({
        daysOpen: { contains: d, mode: "insensitive" },
      })),
    });
    // Note: we *don’t* try to SQL-match openingHours JSON text — we’ll do precise parse below
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

      // helpful for post-filter & debug
      daysOpen: true,
      openingHours: true,

      // helpful if the UI wants to show what was selected
      routePlanEnabled: true,
      routeWeeks: true,
      routeDays: true,
    },
    orderBy: [{ postCode: "asc" }, { salonName: "asc" }],
    take: limit,
  });

  // Precise post-filter by openingHours JSON (ANY of selected days with open:true)
  let filtered = customers;
  if (daysOpenFilter.length) {
    filtered = customers.filter(c => {
      // 1) CSV tokens
      const csvTokens = tokensFromDaysOpen(c.daysOpen);
      const csvHit = daysOpenFilter.some(d => csvTokens.has(d));

      // 2) JSON openingHours tokens (exact open:true)
      const ohTokens = openDaysFromOpeningHours(c.openingHours);
      const ohHit = daysOpenFilter.some(d => ohTokens.has(d));

      // If either CSV or openingHours says open on any selected day, include
      return csvHit || ohHit;
    });
  }

  return NextResponse.json(filtered);
}
