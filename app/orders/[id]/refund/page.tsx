import Link from "next/link";
import { prisma } from "@/lib/prisma";
import RefundFormClient from "./RefundFormClient";

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

export default async function RefundPage({ params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, salonName: true, customerName: true } },
      lineItems: true,
    },
  });

  if (!order) {
    return (
      <div className="card">
        <h2>Order not found</h2>
        <Link className="primary" href="/customers">Back</Link>
      </div>
    );
  }

  const currency = (order.currency || "GBP").toUpperCase();

  // Prepare lines for the client component
  const lines = order.lineItems.map((li) => ({
    id: li.id,
    productTitle: li.productTitle || li.variantTitle || "-",
    sku: li.sku || null,
    maxQty: Number(li.quantity || 0),
    unitNet: Number(li.price || 0), // your DB stores ex-VAT
  }));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ margin: 0 }}>
            Refund {order.shopifyName || `Order ${order.shopifyOrderNumber ?? ""}`}
          </h1>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href={`/orders/${order.id}`}>Back to order</Link>
            <Link className="primary" href={order.customer ? `/customers/${order.customer.id}` : "/customers"}>
              Back to customer
            </Link>
          </div>
        </div>

        <p className="small muted" style={{ marginTop: 8 }}>
          Select the items/quantities to refund. The refund will be issued back via the original payment method.
        </p>

        <RefundFormClient
          orderId={order.id}
          currency={currency}
          vatRate={VAT_RATE}
          lines={lines}
        />
      </div>
    </div>
  );
}
