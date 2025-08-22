import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

export async function POST(req: Request, { params }: Params) {
  const { text, staff } = await req.json();
  if (!text) return new NextResponse("Missing text", { status: 400 });
  const note = await prisma.note.create({
    data: { text, staff, customerId: params.id }
  });
  return NextResponse.json(note);
}
