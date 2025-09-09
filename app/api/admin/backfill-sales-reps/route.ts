// app/api/admin/backfill-sales-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSalesRepForTags, shopifyRest } from "@/lib/shopify";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Query params:
 *   secret=...            (required) must match BACKFILL_SECRET env
 *   mode=apply|dry-run    default: dry-run
 *   source=db|shopify|auto
 *       db     → use Customer.shopifyTags stored in CRM
 *       shopify→ call Shopify live for tags
 *       auto   → prefer stored tags; fall back to Shopify if none
 *   limit=100             how many to process in this call (max 500)
 *   cursor=<id>           pagination cursor (last processed id)
 *   reeval=0|1            when 1, re-evaluate all customers (even those with salesRep already)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret") || "";
  if (!process.env.BACKFILL_SECRET || secret !== process.env.BACKFILL_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const mode = (searchParams.get("mode") || "dry-run").toLowerCase();
  const apply = mode === "apply";

  const source = (searchParams.get("source") || "auto").toLowerCase() as
    | "db"
    | "shopify"
    | "auto";

  const reeval = searchParams.get("reeval") === "1";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10) || 100, 1), 500);
  const cursor = searchParams.get("cursor") || undefined;

  // Build where clause: either all customers (reeval) or only those missing a rep
  const where: Prisma.CustomerWhereInput = reeval
    ? {}
    : { OR: [{ salesRep: null }, { salesRep: "" }] };

  const findArgs: Prisma.CustomerFindManyArgs = {
    where,
    select: {
      id: true,
      salonName: true,
      salesRep: true,
      shopifyCustomerId: true,
      shopifyTags: true, // stored tags array
    },
    orderBy: { id: "asc" },
    take: limit,
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const batch = await prisma.customer.findMany(findArgs);

  let updated = 0;
  let skippedNoTags = 0;
  let skippedNoRep = 0;
  let keptSame = 0;

  const results: Array<{
    id: string;
    oldRep: string | null;
    newRep: string | null;
    reason?: string;
  }> = [];

  // Helper to fetch tags from Shopify for a given customer id
  async function fetchTagsFromShopify(shopifyId: string | null): Promise<string[]> {
    if (!shopifyId) return [];
    try {
      const res = await shopifyRest(`/customers/${shopifyId}.json`, { method: "GET" });
      if (!res.ok) return [];
      const json = await res.json();
      const raw = json?.customer?.tags;
      if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
      if (typeof raw === "string")
        return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
      return [];
    } catch {
      return [];
    }
  }

  for (const c of batch) {
    // Decide tags source
    let tags: string[] = [];
    if (source === "db") {
      tags = (c.shopifyTags || []).map(String).map(s => s.trim()).filter(Boolean);
    } else if (source === "shopify") {
      tags = await fetchTagsFromShopify(c.shopifyCustomerId);
    } else {
      // auto
      const stored = (c.shopifyTags || []).map(String).map(s => s.trim()).filter(Boolean);
      tags = stored.length ? stored : await fetchTagsFromShopify(c.shopifyCustomerId);
    }

    if (!tags.length) {
      skippedNoTags++;
      results.push({ id: c.id, oldRep: c.salesRep, newRep: null, reason: "no-tags" });
      continue;
    }

    const mapped = await getSalesRepForTags(tags); // returns a SalesRep.name or null
    if (!mapped) {
      skippedNoRep++;
      results.push({ id: c.id, oldRep: c.salesRep, newRep: null, reason: "no-matching-rep" });
      continue;
    }

    // Skip if already the same (unless reeval, but even then no update needed)
    if ((c.salesRep || "").trim().toLowerCase() === mapped.trim().toLowerCase()) {
      keptSame++;
      results.push({ id: c.id, oldRep: c.salesRep, newRep: mapped, reason: "already-set" });
      continue;
    }

    if (apply) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { salesRep: mapped },
      });
    }
    updated++;
    results.push({ id: c.id, oldRep: c.salesRep, newRep: mapped });
  }

  const nextCursor = batch.length === limit ? batch[batch.length - 1].id : null;

  return NextResponse.json({
    mode: apply ? "apply" : "dry-run",
    source,
    reeval,
    processed: batch.length,
    updated,
    keptSame,
    skippedNoTags,
    skippedNoRep,
    nextCursor,
    // Trim results for readability; comment out if you want the full list
    sample: results.slice(0, 20),
  });
}
