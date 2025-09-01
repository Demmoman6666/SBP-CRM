// app/education/requests/new/page.tsx
import { prisma } from "@/lib/prisma";
import EducationRequestForm from "@/components/EducationRequestForm";

export const dynamic = "force-dynamic";

export default async function NewEducationRequestPage({
  searchParams,
}: {
  searchParams: { customerId?: string };
}) {
  const customerId = searchParams?.customerId || "";

  const customer = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          salonName: true,
          customerName: true,
          customerTelephone: true,
          customerEmailAddress: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          county: true,
          postCode: true,
          country: true,
          salesRep: true,
        },
      })
    : null;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Request Education</h1>
        <p className="small">
          {customer
            ? "Review the details below, choose brands and education types, then submit."
            : "No customer selected. Open a customer profile and click “Request Education”."
          }
        </p>
      </section>

      <section className="card">
        <EducationRequestForm customer={customer} />
      </section>
    </div>
  );
}
