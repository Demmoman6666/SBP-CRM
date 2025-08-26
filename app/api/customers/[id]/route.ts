// app/api/customers/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/* ------------ body reader (json/form) ------------ */
async function readBody(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("application/json"))        return await req.json();
  if (ct.includes("multipart/form-data"))     return Object.fromEntries((await req.formData()).entries());
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  // fallbacks
  try { return await req.json(); } catch {}
  try {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {}
  return {};
}

const toInt = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const norm = (v: unknown) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const normEmail = (v: unknown) => {
  const s = norm(v);
  return s ? s.toLowerCase() : s;
};

/* ------------------ GET /api/customers/[id] ------------------ */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      visits:   { orderBy: { date: "desc" } },
      notesLog: { orderBy: { createdAt: "desc" } },
      callLogs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(customer);
}

/* ------------------ PATCH /api/customers/[id] (update) ------------------ */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const existing = await prisma.customer.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body: any = await readBody(req);

    // Build "final" values by merging incoming values with existing ones
    const finalSalonName            = norm(body.salonName)            ?? existing.salonName;
    const finalCustomerName         = norm(body.customerName)         ?? existing.customerName;
    const finalAddressLine1         = norm(body.addressLine1)         ?? existing.addressLine1;
    const finalSalesRep             = norm(body.salesRep)             ?? existing.salesRep ?? "";

    // Validate required after merge
    if (!finalSalonName || !finalCustomerName || !finalAddressLine1 || !finalSalesRep) {
      return NextResponse.json(
        { error: "Missing required fields: salonName, customerName, addressLine1, salesRep" },
        { status: 400 }
      );
    }

    const data = {
      salonName:            finalSalonName,
      customerName:         finalCustomerName,
      addressLine1:         finalAddressLine1,
      addressLine2:         (body.addressLine2 !== undefined ? norm(body.addressLine2) : existing.addressLine2),
      town:                 (body.town !== undefined ? norm(body.town) : existing.town),
      county:               (body.county !== undefined ? norm(body.county) : existing.county),
      postCode:             (body.postCode !== undefined ? norm(body.postCode) : existing.postCode),
      brandsInterestedIn:   (body.brandsInterestedIn !== undefined ? norm(body.brandsInterestedIn) : existing.brandsInterestedIn),
      notes:                (body.notes !== undefined ? norm(body.notes) : existing.notes),
      salesRep:             finalSalesRep,
      customerNumber:       (body.customerNumber !== undefined ? norm(body.customerNumber) : existing.customerNumber),
      customerTelephone:    (body.customerTelephone !== undefined ? norm(body.customerTelephone) : existing.customerTelephone),
      customerEmailAddress: (body.customerEmailAddress !== undefined ? normEmail(body.customerEmailAddress) : existing.customerEmailAddress),
      openingHours:         (body.openingHours !== undefined ? (body.openingHours ?? null) : existing.openingHours),
      numberOfChairs:       (body.numberOfChairs !== undefined ? toInt(body.numberOfChairs) : existing.numberOfChairs),
    };

    const updated = await prisma.customer.update({
      where: { id: params.id },
      data,
    });

    // 🔄 Best-effort push to Shopify (step 6). Uses dynamic import so this route
    // still builds even if you haven’t added the helper yet.
    try {
      const mod: any = await import("@/lib/shopify");
      if (typeof mod?.pushCustomerToShopifyById === "function") {
        await mod.pushCustomerToShopifyById(updated.id);
      }
    } catch (e) {
      console.warn("Shopify push skipped:", (e as Error)?.message ?? e);
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("PATCH /api/customers/[id] error:", err);
    return NextResponse.json({ error: err?.message ?? "Update failed" }, { status: 500 });
  }
}

/* ------------------ DELETE /api/customers/[id] ------------------ */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    // Ensure call logs don't block deletion if referential action isn't applied
    await prisma.callLog.updateMany({
      where: { customerId: params.id },
      data:  { customerId: null },
    });

    // These two are typically CASCADE in your schema; this is a safe extra step
    await prisma.visit.deleteMany({ where: { customerId: params.id } });
    await prisma.note.deleteMany({ where: { customerId: params.id } });

    await prisma.customer.delete({ where: { id: params.id } });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE /api/customers/[id] error:", err);
    return NextResponse.json({ error: err?.message ?? "Delete failed" }, { status: 500 });
  }
}
