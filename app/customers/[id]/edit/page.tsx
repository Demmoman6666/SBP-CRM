// app/customers/[id]/edit/page.tsx
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import EditForm from "./EditForm";

export default async function EditCustomerPage({
  params,
}: { params: { id: string } }) {
  const [customer, reps, brands] = await Promise.all([
    prisma.customer.findUnique({ where: { id: params.id } }),
    prisma.salesRep.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!customer) {
    return (
      <div className="card">
        <h2>Not found</h2>
        <p className="small">No customer with id {params.id}.</p>
        <Link className="primary" href="/customers">Back to customers</Link>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Edit Customer</h1>
        <p className="small">
          {customer.salonName} — {customer.customerName}
        </p>
      </section>

      <section className="card">
        <EditForm
          id={customer.id}
          initial={{
            salonName: customer.salonName || "",
            customerName: customer.customerName || "",
            addressLine1: customer.addressLine1 || "",
            addressLine2: customer.addressLine2 || "",
            town: customer.town || "",
            county: customer.county || "",
            postCode: customer.postCode || "",
            country: customer.country || "",                 // ← NEW
            customerTelephone: customer.customerTelephone || "",
            customerEmailAddress: customer.customerEmailAddress || "",
            brandsInterestedIn: customer.brandsInterestedIn || "",
            salesRep: customer.salesRep || "",
            numberOfChairs: customer.numberOfChairs ?? undefined,
            notes: customer.notes || "",
            openingHours: customer.openingHours || "",        // ← NEW
          }}
          reps={reps}
          brands={brands}
        />
      </section>
    </div>
  );
}
