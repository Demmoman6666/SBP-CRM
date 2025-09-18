// app/orders/[id]/refund/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

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
        <Link className="primary" href="/customers">Back</Link>
      </div>
    );
  }

  const currency = order.currency || "GBP";

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

        <form
          method="POST"
          action={`/api/orders/${order.id}/refund`}
          className="grid"
          style={{ gap: 12, marginTop: 12 }}
        >
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
            <div className="small muted">Qty (max)</div>
            <div className="small muted">Unit</div>
            <div className="small muted">Refund Qty</div>

            {order.lineItems.map((li) => (
              <div key={li.id} style={{ display: "contents" }}>
                <div>{li.productTitle || li.variantTitle || "-"}</div>
                <div>{li.sku || "-"}</div>
                <div>{li.quantity}</div>
                <div>{money(li.price, currency)}</div>
                <div>
                  <input
                    type="number"
                    name={`qty_${li.id}`}
                    min={0}
                    max={li.quantity}
                    defaultValue={0}
                    style={{ width: 90 }}
                  />
                </div>
              </div>
            ))}
          </div>

          <textarea
            name="reason"
            placeholder="Reason (optional)"
            className="textarea"
            rows={3}
          />

          <div className="right row" style={{ gap: 8 }}>
            <Link className="btn" href={`/orders/${order.id}`}>Cancel</Link>
            <button className="primary" type="submit">Process refund</button>
          </div>
        </form>
      </div>
    </div>
  );
}
