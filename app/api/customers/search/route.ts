import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json([]);

  const matches = await prisma.customer.findMany({
    where: {
      OR: [
        { salonName: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerEmailAddress: { contains: q, mode: "insensitive" } },
        { postCode: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      salonName: true,
      customerName: true,
      postCode: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return NextResponse.json(
    matches.map((c) => ({
      id: c.id,
      label: [c.salonName, c.customerName, c.postCode].filter(Boolean).join(" — "),
    }))
  );
}
