// app/customers/[id]/RecentOrders.tsx
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

export default async function RecentOrders({ customerId, take = 10 }: { customerId: string; take?: number }) {
  const orders = await prisma.order.findMany({
    where: { customerId },
    orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      processedAt: true,
      shopifyOrderNumber: true,
      shopifyName: true,
      currency: true,
      subtotal: true,
      taxes: true,
      total: true,
      financialStatus: true,
      fulfillmentStatus: true,
    },
  });

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Recent Orders</h3>
        <span className="small muted">{orders.length} shown</span>
      </div>

      {orders.length === 0 ? (
        <p className="small muted" style={{ marginTop: 8 }}>No orders for this customer yet.</p>
      ) : (
        <div className="table" style={{ marginTop: 12 }}>
          <div className="thead row muted small" style={{ gap: 12 }}>
            <div style={{ flex: "0 0 170px" }}>Date</div>
            <div style={{ flex: "0 0 140px" }}>Order #</div>
            <div style={{ flex: "1 1 auto" }}>Sub-total</div>
            <div style={{ flex: "1 1 auto" }}>Taxes</div>
            <div style={{ flex: "1 1 auto" }}>Total</div>
            <div style={{ flex: "0 0 160px" }}>Financial</div>
            <div style={{ flex: "0 0 160px" }}>Fulfilment</div>
            <div style={{ flex: "0 0 80px" }}></div>
          </div>

          {orders.map(o => (
            <div key={o.id} className="row" style={{ gap: 12, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ flex: "0 0 170px" }}>{fmtDate(o.processedAt)}</div>
              <div style={{ flex: "0 0 140px" }}>{o.shopifyName ?? o.shopifyOrderNumber ?? "—"}</div>
              <div style={{ flex: "1 1 auto" }}>{fmtMoney(o.subtotal, o.currency)}</div>
              <div style={{ flex: "1 1 auto" }}>{fmtMoney(o.taxes, o.currency)}</div>
              <div style={{ flex: "1 1 auto", fontWeight: 600 }}>{fmtMoney(o.total, o.currency)}</div>
              <div style={{ flex: "0 0 160px" }} className="small">{o.financialStatus ?? "—"}</div>
              <div style={{ flex: "0 0 160px" }} className="small">{o.fulfillmentStatus ?? "—"}</div>
              <div style={{ flex: "0 0 80px" }}>
                <Link className="button" href={`/orders/${o.id}`}>View</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
