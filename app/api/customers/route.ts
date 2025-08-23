// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

async function readBody(req: Request) {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    return await req.json();
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries(
      Array.from(form.entries()).map(([k, v]) => [k, typeof v === "string" ? v : v.name])
    );
  }

  // Fallbacks
  try { return await req.json(); } catch {}
  try {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {}
  return {};
}

/* -----------------------------
   POST /api/customers
   Create customer (JSON or form)
------------------------------ */
export async function POST(req: Request) {
  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    const isForm =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data");

    const body = await readBody(req);

    const toInt = (v: unknown) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const data = {
      salonName: (body.salonName ?? null) as string | null,
      customerName: (body.customerName ?? null) as string | null,
      addressLine1: (body.addressLine1 ?? null) as string | null,
      addressLine2: (body.addressLine2 ?? null) as string | null,
      town: (body.town ?? null) as string | null,
      county: (body.county ?? null) as string | null,
      postCode: (body.postCode ?? null) as string | null,
      daysOpen: (body.daysOpen ?? null) as string | null,
      brandsInterestedIn: (body.brandsInterestedIn ?? null) as string | null,
      notes: (body.notes ?? null) as string | null,
      salesRep: (body.salesRep ?? null) as string | null,
      customerNumber: (body.customerNumber ?? null) as string | null,
      customerTelephone: (body.customerTelephone ?? null) as string | null, // optional
      customerEmailAddress: (body.customerEmailAddress ?? null) as string | null,
      openingHours: (body.openingHours ?? null) as string | null,
      numberOfChairs: toInt(body.numberOfChairs),
    };

    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        { error: "Missing required fields: salonName, customerName, addressLine1" },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });

    if (isForm) {
      return NextResponse.redirect(new URL(`/customers/${created.id}`, req.url), { status: 303 });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("Create customer error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/* -----------------------------
   GET /api/customers
   Search (for pickers) and list
   - ?search= / ?q=  : query string
   - ?take=number    : limit (default 20; max 50)
------------------------------ */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("search") || searchParams.get("q") || "").trim();
  const takeParam = Number(searchParams.get("take") || 20);
  const take = Math.min(Math.max(takeParam, 1), 50);

  const where = q
    ? {
        OR: [
          { salonName: { contains: q, mode: "insensitive" as const } },
          { customerName: { contains: q, mode: "insensitive" as const } },
          { customerEmailAddress: { contains: q, mode: "insensitive" as const } },
          { town: { contains: q, mode: "insensitive" as const } },
          { county: { contains: q, mode: "insensitive" as const } },
          { postCode: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    orderBy: q ? { salonName: "asc" } : { createdAt: "desc" },
    take: q ? take : 50,
    // Include address + contact so the picker can preview details
    select: {
      id: true,
      salonName: true,
      customerName: true,
      addressLine1: true,
      addressLine2: true,
      town: true,
      county: true,
      postCode: true,
      customerEmailAddress: true,
      customerNumber: true,      // added
      customerTelephone: true,   // added
    },
  });

  return NextResponse.json(customers);
}
