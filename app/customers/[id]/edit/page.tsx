// app/customers/[id]/edit/page.tsx
import { prisma } from "@/lib/prisma";
import EditForm from "./EditForm";

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  const customer = await prisma.customer.findUnique({ where: { id: params.id } });
  if (!customer) return <div className="card">Not found.</div>;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>Edit Customer</h2>
        <p className="small">{customer.salonName} — {customer.customerName}</p>
      </div>

      <EditForm id={customer.id} initial={customer} />
    </div>
  );
}
