// app/orders/[id]/refund/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import RefundClient, { type Line as RefundLine } from "./RefundClient";

function money(n?: any, currency?: string) {
  if (n == null) return "-";
  const num = typeof n === "string" ? parseFloat(n) : Number(n);
  if (!Number.isFinite(num)) return String(n);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "GBP",
    }).format(num);
  } catch {
    return num.toFixed(2);
  }
}

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
        <Link className="primary" href="/customers">
          Back
        </Link>
      </div>
    );
  }

  const currency = order.currency || "GBP";

  // Build the shape RefundClient expects
  const lines: RefundLine[] = order.lineItems.map((li) => ({
    id: li.id,
    maxQty: Number(li.quantity || 0),
    // pass through for Shopify's refund API mapping
    shopifyLineItemId: li.shopifyLineItemId ? String(li.shopifyLineItemId) : null,
    // unit price (ex VAT) so the client can show a rough calc if needed
    unitNet:
      typeof li.price === "number"
        ? li.price
        : Number.isFinite(Number(li.price))
        ? Number(li.price)
        : null,
    // optional display helpers (RefundClient may ignore these)
    productTitle: li.productTitle ?? li.variantTitle ?? null,
    sku: li.sku ?? null,
  }));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ margin: 0 }}>
            Refund {order.shopifyName || `Order ${order.shopifyOrderNumber ?? ""}`}
          </h1>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href={`/orders/${order.id}`}>
              Back to order
            </Link>
            <Link
              className="primary"
              href={order.customer ? `/customers/${order.customer.id}` : "/customers"}
            >
              Back to customer
            </Link>
          </div>
        </div>

        <p className="small muted" style={{ marginTop: 8 }}>
          Select the items/quantities to refund. The refund will be issued back via the original
          payment method.
        </p>

        {/* Client component renders the editable quantities, live total, and preview */}
        <RefundClient
          orderId={order.id}
          currency={currency}
          lines={lines}
        />
      </div>
    </div>
  );
}
