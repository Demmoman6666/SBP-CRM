// app/orders/[id]/page.tsx
import { prisma } from "@/lib/prisma";
import Link from "next/link";

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

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  // ⬇️ Load order + customer + line items
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

  const lines = order.lineItems;
  const when = order.processedAt ?? order.createdAt;
  const currency = order.currency || "GBP";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ margin: 0 }}>{order.shopifyName || `Order ${order.shopifyOrderNumber ?? ""}`}</h1>

          {/* Actions: Refund + Back to customer */}
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href={`/orders/${order.id}/refund`}>
              Refund
            </Link>
            <Link
              className="primary"
              href={order.customer ? `/customers/${order.customer.id}` : "/customers"}
            >
              Back to customer
            </Link>
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <b>Customer</b>
            <p className="small" style={{ marginTop: 6 }}>
              {order.customer?.salonName || "-"}
              <br />
              {order.customer?.customerName || ""}
            </p>
          </div>
          <div>
            <b>Date</b>
            <p className="small" style={{ marginTop: 6 }}>
              {when ? new Date(when).toLocaleString() : "-"}
            </p>
          </div>
          <div>
            <b>Financial Status</b>
            <p className="small" style={{ marginTop: 6 }}>{order.financialStatus || "-"}</p>
          </div>
          <div>
            <b>Fulfillment Status</b>
            <p className="small" style={{ marginTop: 6 }}>{order.fulfillmentStatus || "-"}</p>
          </div>
          <div>
            <b>Subtotal</b>
            <p className="small" style={{ marginTop: 6 }}>{money(order.subtotal, currency)}</p>
          </div>
          <div>
            <b>Taxes</b>
            <p className="small" style={{ marginTop: 6 }}>{money(order.taxes, currency)}</p>
          </div>
          <div>
            <b>Discounts</b>
            <p className="small" style={{ marginTop: 6 }}>{money(order.discounts, currency)}</p>
          </div>
          <div>
            <b>Shipping</b>
            <p className="small" style={{ marginTop: 6 }}>{money(order.shipping, currency)}</p>
          </div>
          <div>
            <b>Total</b>
            <p className="small" style={{ marginTop: 6 }}>{money(order.total, currency)}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Line Items</h3>
        {lines.length === 0 ? (
          <p className="small">No items.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div className="small muted">Product</div>
            <div className="small muted">SKU</div>
            <div className="small muted">Qty</div>
            <div className="small muted">Unit</div>
            <div className="small muted">Line Total</div>

            {lines.map((li) => (
              <div key={li.id} style={{ display: "contents" }}>
                <div>{li.productTitle || li.variantTitle || "-"}</div>
                <div>{li.sku || "-"}</div>
                <div>{li.quantity}</div>
                <div>{money(li.price, currency)}</div>
                <div>{money(li.total, currency)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
