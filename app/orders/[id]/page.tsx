// app/orders/[id]/page.tsx
import { prisma } from "@/lib/prisma";
import Link from "next/link";

function fmtMoney(value: number | null | undefined, currency?: string | null) {
  const cur = currency || "GBP";
  const n = typeof value === "number" ? value : 0;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);
}
function fmtDate(d?: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(d));
}

export default async function OrderPage({ params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, salonName: true, customerName: true } },
      lineItems: true, // if your relation is named "orderLineItems", change to { include: { orderLineItems: true } }
    },
  });

  if (!order) {
    return (
      <div className="card">
        <h2>Order not found</h2>
        <p className="small muted">No order with id {params.id}.</p>
        <Link className="primary" href="/customers">Back</Link>
      </div>
    );
  }

  const currency = order.currency ?? "GBP";
  const lines = (order as any).lineItems ?? (order as any).orderLineItems ?? [];

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{order.shopifyName ?? `Order #${order.shopifyOrderNumber ?? "—"}`}</h1>
          <div className="small muted">
            {order.customer ? (
              <>
                <Link href={`/customers/${order.customer.id}`}>{order.customer.salonName}</Link>{" "}
                — {order.customer.customerName}
              </>
            ) : (
              "Unlinked customer"
            )}
            {" • "}Placed: {fmtDate(order.processedAt)}
          </div>
        </div>
        <div className="right small">
          <div>Financial: <b>{order.financialStatus ?? "—"}</b></div>
          <div>Fulfilment: <b>{order.fulfillmentStatus ?? "—"}</b></div>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Line Items</h3>

        {lines.length === 0 ? (
          <p className="small muted">No line items on this order.</p>
        ) : (
          <div className="table">
            <div className="thead row muted small" style={{ gap: 12 }}>
              <div style={{ flex: "2 1 320px" }}>Product</div>
              <div style={{ flex: "1 1 180px" }}>Variant</div>
              <div style={{ flex: "0 0 120px" }}>SKU</div>
              <div style={{ flex: "0 0 80px", textAlign: "right" }}>Qty</div>
              <div style={{ flex: "0 0 140px", textAlign: "right" }}>Unit</div>
              <div style={{ flex: "0 0 160px", textAlign: "right" }}>Line Total</div>
            </div>

            {lines.map((li: any) => (
              <div key={li.id ?? `${li.sku}-${li.productId}-${li.variantId}`} className="row"
                   style={{ gap: 12, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ flex: "2 1 320px" }}>{li.productTitle ?? "—"}</div>
                <div style={{ flex: "1 1 180px" }}>{li.variantTitle ?? "—"}</div>
                <div style={{ flex: "0 0 120px" }} className="small muted">{li.sku ?? "—"}</div>
                <div style={{ flex: "0 0 80px", textAlign: "right" }}>{li.quantity ?? 0}</div>
                <div style={{ flex: "0 0 140px", textAlign: "right" }}>{fmtMoney(li.price, currency)}</div>
                <div style={{ flex: "0 0 160px", textAlign: "right", fontWeight: 600 }}>
                  {fmtMoney(li.total, currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card right" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: "flex-end", gap: 24 }}>
          <div className="small muted">Subtotal</div>
          <div style={{ minWidth: 140, textAlign: "right" }}>{fmtMoney(order.subtotal, currency)}</div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 24 }}>
          <div className="small muted">Discounts</div>
          <div style={{ minWidth: 140, textAlign: "right" }}>{fmtMoney(order.discounts, currency)}</div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 24 }}>
          <div className="small muted">Shipping</div>
          <div style={{ minWidth: 140, textAlign: "right" }}>{fmtMoney(order.shipping, currency)}</div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 24 }}>
          <div className="small muted">Taxes</div>
          <div style={{ minWidth: 140, textAlign: "right" }}>{fmtMoney(order.taxes, currency)}</div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 24, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div style={{ fontWeight: 700 }}>Total</div>
          <div style={{ minWidth: 140, textAlign: "right", fontWeight: 700 }}>{fmtMoney(order.total, currency)}</div>
        </div>
      </section>
    </div>
  );
}
