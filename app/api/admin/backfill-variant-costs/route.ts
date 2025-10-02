// app/api/admin/backfill-variant-costs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVariantCostsOnce } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VariantCostEntry = {
  unitCost: number | null;
  currency: string | null;
  // inventoryItemId intentionally ignored when writing to DB (column not in schema)
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const toNum = (x: any): number | null => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Accepts a Map<string, {unitCost,...}> | Record<string, number | {unitCost,...}> and returns a Map */
function normalizeCostMap(raw: unknown): Map<string, VariantCostEntry> {
  const m = new Map<string, VariantCostEntry>();
  if (!raw) return m;

  const setEntry = (key: string, val: any) => {
    if (val == null) return;
    if (typeof val === "number") {
      m.set(String(key), { unitCost: toNum(val), currency: null });
      return;
    }
    if (typeof val === "object") {
      const v = val as any;
      m.set(String(key), {
        unitCost: toNum(v.unitCost ?? v.cost ?? v.price),
        currency: v.currency ?? null,
      });
    }
  };

  if (raw instanceof Map) {
    for (const [k, v] of raw.entries()) setEntry(String(k), v);
    return m;
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) setEntry(k, v);
  }
  return m;
}

export async function GET(req: NextRequest) {
  try {
    const confirm = ["1", "true", "yes"].includes(
      (new URL(req.url).searchParams.get("confirm") || "").toLowerCase()
    );

    // 1) Collect all variantIds present in order lines
    const variants = await prisma.orderLineItem.findMany({
      where: { variantId: { not: null } },
      select: { variantId: true },
    });

    const allVariantIds = Array.from(
      new Set(
        variants
          .map((v) => (v.variantId || "").trim())
          .filter((v) => v.length > 0)
      )
    );

    // 2) Which are already cached?
    const cached = await prisma.shopifyVariantCost.findMany({
      where: { variantId: { in: allVariantIds } },
      select: { variantId: true },
    });
    const cachedSet = new Set(cached.map((c) => c.variantId));

    // 3) Missing set
    const toFetch = allVariantIds.filter((id) => !cachedSet.has(id));

    if (!confirm) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        discovered: allVariantIds.length,
        alreadyCached: cachedSet.size,
        toFetch: toFetch.length,
        message: "Add ?confirm=1 to perform the backfill.",
      });
    }

    // 4) Fetch in chunks and upsert (no inventoryItemId column written)
    let fetched = 0;
    let upserted = 0;

    for (const batch of chunk(toFetch, 50)) {
      const raw = await fetchVariantCostsOnce(batch);
      const costMap = normalizeCostMap(raw);
      fetched += batch.length;

      for (const id of batch) {
        const key = `${id}`; // safe string key
        const entry = costMap.get(key);
        if (!entry) continue;

        await prisma.shopifyVariantCost.upsert({
          where: { variantId: key },
          create: {
            variantId: key,
            unitCost: entry.unitCost,
            currency: entry.currency,
          },
          update: {
            unitCost: entry.unitCost,
            currency: entry.currency,
          },
        });
        upserted++;
      }
    }

    return NextResponse.json({
      ok: true,
      discovered: allVariantIds.length,
      alreadyCached: cachedSet.size,
      fetched,
      upserted,
    });
  } catch (err: any) {
    console.error("Backfill variant costs failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
