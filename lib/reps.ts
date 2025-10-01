// lib/reps.ts
import { prisma } from "@/lib/prisma";

export type Rep = { id: string; name: string; active: boolean };

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "");

export async function getAllReps(): Promise<Rep[]> {
  const reps = await prisma.salesRep.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true },
  });
  return reps;
}

/** Resolve a rep from id or a free-typed name using aliases and fuzzy match */
export async function resolveRep(params: { id?: string | null; name?: string | null }) {
  const { id, name } = params;
  if (id) {
    const rep = await prisma.salesRep.findUnique({ where: { id }, select: { id: true, name: true } });
    if (rep) return rep;
  }
  const n = name ? norm(name) : "";
  if (!n) return null;

  // 1) exact alias
  const alias = await prisma.salesRepAlias.findUnique({ where: { alias: n } });
  if (alias) {
    const rep = await prisma.salesRep.findUnique({ where: { id: alias.repId }, select: { id: true, name: true } });
    if (rep) return rep;
  }

  // 2) exact name match
  const byName = await prisma.salesRep.findFirst({
    where: { name: { equals: name!, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (byName) return byName;

  // 3) last resort: soft match on normalized name
  const all = await prisma.salesRep.findMany({ select: { id: true, name: true } });
  const hit = all.find(r => norm(r.name) === n);
  return hit ?? null;
}
