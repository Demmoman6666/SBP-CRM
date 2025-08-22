// app/api/customers/[id]/notes/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { text, staff } = await req.json();
  if (!text) return new NextResponse("Missing text", { status: 400 });

  const note = await prisma.note.create({
    data: {
      customerId: params.id,
      text,
      staff: staff || null,
    },
  });

  return NextResponse.json(note, { status: 201 });
}
