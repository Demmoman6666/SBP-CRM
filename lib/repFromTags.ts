// lib/repFromTags.ts
import { prisma } from "@/lib/prisma";

/**
 * Resolve a Sales Rep name from a list of Shopify tags.
 * Strategy:
 *  1) Exact match with SalesRepTagRule.tag (case-insensitive)
 *  2) Exact match with SalesRep.name (case-insensitive)
 *
 * Returns the rep name or null if no match.
 */
export async function resolveRepNameFromTags(tags: string[] | null | undefined): Promise<string | null> {
  const norm = (s: string) => s.trim().toLowerCase();
  const set = new Set((tags ?? []).map(norm).filter(Boolean));
  if (set.size === 0) return null;

  // 1) Rule-based mapping
  const rules = await prisma.salesRepTagRule.findMany({
    select: { tag: true, salesRep: { select: { name: true } } },
  });
  for (const r of rules) {
    if (r.salesRep?.name && set.has(norm(r.tag))) {
      return r.salesRep.name;
    }
  }

  // 2) Fallback: a tag equals the rep's name
  const reps = await prisma.salesRep.findMany({ select: { name: true } });
  for (const rep of reps) {
    if (rep.name && set.has(norm(rep.name))) {
      return rep.name;
    }
  }

  return null;
}
