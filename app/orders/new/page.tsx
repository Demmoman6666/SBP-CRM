// app/orders/new/page.tsx
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import ClientNewOrder from "./ClientNewOrder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: { customerId?: string };
};

export default async function Page({ searchParams }: PageProps) {
  const customerId = searchParams?.customerId || "";

  const initialCustomer = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          salonName: true,
          customerName: true,
          customerEmailAddress: true,
          customerTelephone: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          county: true,
          postCode: true,
          country: true,
        },
      })
    : null;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Create Order</h1>
      </section>

      <Suspense fallback={<div className="card">Loading order builder…</div>}>
        <ClientNewOrder initialCustomer={initialCustomer} />
      </Suspense>
    </div>
  );
}
