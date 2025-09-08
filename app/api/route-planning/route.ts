// app/api/route-planning/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */
function parseCommaList(param: string | null): string[] {
  if (!param) return [];
  return param.split(",").map(s => s.trim()).filter(Boolean);
}
function parsePrefixes(param: string | null): string[] {
  if (!param) return [];
  return param.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

// Accept Mon,Tue,Wed,Thu,Fri,Sat,Sun (or full names)
const DOW_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] as const;
type DowShort = typeof DOW_SHORT[number];

function normDayToken(s: string): DowShort | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
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

// Parse openingHours JSON into a set of open days
function openDaysFromOpeningHours(src?: string | null): Set<DowShort> {
  const set = new Set<DowShort>();
  if (!src) return set;
  try {
    const obj = JSON.parse(src);
    if (obj && typeof obj === "object") {
      for (const d of DOW_SHORT) {
        const it = (obj as any)[d];
        // Count as open if explicitly open:true OR (no flag but has times)
        if (
          (it && typeof it === "object" && it.open === true) ||
          (it && (it.from || it.to))
        ) set.add(d);
      }
    }
  } catch {}
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

/* ---------------- main ---------------- */
const VALID_ROUTE_DAYS = new Set(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const reps = parseCommaList(searchParams.get("reps"));
  const prefixes = parsePrefixes(searchParams.get("pc")).map(p => p.toUpperCase().replace(/\s+/g, ""));

  const onlyPlanned = searchParams.get("onlyPlanned") === "1";
  const weekRaw = Number(searchParams.get("week") || "");
  const week = Number.isInteger(weekRaw) && weekRaw >= 1 && weekRaw <= 4 ? weekRaw : null;

  const dayRaw = (searchParams.get("day") || "").trim().toUpperCase();
  const day = VALID_ROUTE_DAYS.has(dayRaw) ? dayRaw : null;

  // NEW: Days Open (Mon,Tue,...) from Route Planner
  const daysOpenFilter = parseDays(searchParams.get("days"));

  const limit = Math.min(Math.max(Number(searchParams.get("limit") || "200"), 1), 1000);

  const andFilters: Prisma.CustomerWhereInput[] = [];

  if (reps.length) {
    andFilters.push({ OR: reps.map(r => ({ salesRep: { equals: r, mode: "insensitive" } })) });
  }
  if (prefixes.length) {
    andFilters.push({ OR: prefixes.map(p => ({ postCode: { startsWith: p, mode: "insensitive" } })) });
  }

  // Route Plan page filters
  if (onlyPlanned || week || day) andFilters.push({ routePlanEnabled: true });
  if (week) andFilters.push({ routeWeeks: { has: week } });
  if (day)  andFilters.push({ routeDays: { has: day as any } });

  // IMPORTANT: do NOT SQL-prefilter by daysOpen, otherwise customers who only have openingHours JSON get excluded.
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

      // For open-days filtering
      daysOpen: true,
      openingHours: true,

      // Route plan flags
      routePlanEnabled: true,
      routeWeeks: true,
      routeDays: true,
    },
    orderBy: [{ postCode: "asc" }, { salonName: "asc" }],
    take: limit,
  });

  // Post-filter for Days Open: include if ANY selected day is open (in CSV or JSON)
  const filtered =
    daysOpenFilter.length === 0
      ? customers
      : customers.filter(c => {
          const csv = tokensFromDaysOpen(c.daysOpen);
          const oh  = openDaysFromOpeningHours(c.openingHours);
          return daysOpenFilter.some(d => csv.has(d) || oh.has(d));
        });

  return NextResponse.json(filtered);
}
