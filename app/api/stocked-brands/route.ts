// app/api/stocked-brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeName(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET() {
  const items = await prisma.stockedBrand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    let body: any;

    if (ct.includes("application/json")) body = await req.json();
    else if (ct.includes("multipart/form-data")) {
      body = Object.fromEntries((await req.formData()).entries());
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(await req.text()));
    } else {
      try { body = await req.json(); } catch { body = {}; }
    }

    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }

    const created = await prisma.stockedBrand.create({ data: { name } });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
