// lib/reps.ts
import { prisma } from "@/lib/prisma";

export type Rep = { id: string; name: string };

/** Canonical list of reps from the SalesRep table (id + name only). */
export async function getAllReps(): Promise<Rep[]> {
  const reps = await prisma.salesRep.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return reps;
}

/**
 * Resolve a rep by id or by name (case-insensitive).
 * Returns {id,name} or null if not found.
 */
export async function resolveRep(params: { id?: string | null; name?: string | null }): Promise<Rep | null> {
  const { id, name } = params;

  if (id) {
    const rep = await prisma.salesRep.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (rep) return rep;
  }

  if (name && name.trim()) {
    const rep = await prisma.salesRep.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (rep) return rep;
  }

  return null;
}
