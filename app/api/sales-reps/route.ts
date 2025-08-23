// app/api/sales-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** List sales reps (optionally filter with ?q=) */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  const reps = await prisma.salesRep.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" as const } } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json(reps);
}

/** Add/Upsert a sales rep (JSON or form). Body: { name, email? } */
export async function POST(req: Request) {
  try {
    let body: any;
    const ct = (req.headers.get("content-type") || "").toLowerCase();

    if (ct.includes("application/json")) {
      body = await req.json();
    } else if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      body = Object.fromEntries(form.entries());
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      body = Object.fromEntries(new URLSearchParams(text));
    } else {
      body = await req.json().catch(async () => {
        const text = await req.text().catch(() => "");
        return text ? Object.fromEntries(new URLSearchParams(text)) : {};
      });
    }

    const name = String(body.name || "").trim();
    const email = body.email ? String(body.email) : null;
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Upsert by name to avoid accidental duplicates from the settings modal
    const rep = await prisma.salesRep.upsert({
      where: { name },
      update: { email },
      create: { name, email },
      select: { id: true, name: true, email: true },
    });

    return NextResponse.json(rep, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
