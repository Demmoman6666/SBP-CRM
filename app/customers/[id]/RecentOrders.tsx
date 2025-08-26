// app/customers/[id]/RecentOrders.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

function fmtDate(d?: Date | string | null) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString();
}

function asNumber(n: any): number | null {
  if (n == null) return null;
  try {
    // Prisma.Decimal often has toNumber(); otherwise fall back to toString()/Number()
    if (typeof n === "object") {
      if (typeof (n as any).toNumber === "function") return (n as any).toNumber();
      if (typeof (n as any).toString === "function") {
        const parsed = Number((n as any).toString());
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    const parsed = Number(n);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fmtMoney(n: any, currency?: string) {
  const num = asNumber(n);
  if (num == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "GBP",
      currencyDisplay: "narrowSymbol",
    }).format(num);
  } catch {
    return num.toFixed(2);
  }
}

export default async function RecentOrders({ customerId }: { customerId: string }) {
  const orders = await prisma.order.findMany({
    where: { customerId },
    orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
    take: 10,
    select: {
      id: true,
      processedAt: true,
      createdAt: true,
      shopifyOrderNumber: true,
      shopifyName: true,
      subtotal: true,
      taxes: true,
      total: true,
      currency: true,
      financialStatus: true,
      fulfillmentStatus: true,
    },
  });

  if (orders.length === 0) {
    return (
      <div className="card">
        <h3>Recent Orders</h3>
        <p className="small">No orders found.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Recent Orders</h3>

      <div className="small muted row" style={{ gap: 8, marginBottom: 8 }}>
        <div style={{ flex: "0 0 170px" }}>Date</div>
        <div style={{ flex: "0 0 140px" }}>Order</div>
        <div style={{ flex: "1 1 auto" }}>Subtotal</div>
        <div style={{ flex: "1 1 auto" }}>Taxes</div>
        <div style={{ flex: "1 1 auto" }}>Total</div>
        <div style={{ flex: "0 0 160px" }}>Financial</div>
        <div style={{ flex: "0 0 160px" }}>Fulfillment</div>
        <div style={{ flex: "0 0 80px" }}></div>
      </div>

      {orders.map((o) => (
        <div
          key={o.id}
          className="row"
          style={{
            gap: 8,
            padding: "8px 0",
            borderTop: "1px solid var(--border)",
            alignItems: "center",
          }}
        >
          <div style={{ flex: "0 0 170px" }}>{fmtDate(o.processedAt || o.createdAt)}</div>
          <div style={{ flex: "0 0 140px" }}>{o.shopifyName ?? o.shopifyOrderNumber ?? "—"}</div>
          <div style={{ flex: "1 1 auto" }}>{fmtMoney(o.subtotal, o.currency)}</div>
          <div style={{ flex: "1 1 auto" }}>{fmtMoney(o.taxes, o.currency)}</div>
          <div style={{ flex: "1 1 auto", fontWeight: 600 }}>{fmtMoney(o.total, o.currency)}</div>
          <div style={{ flex: "0 0 160px" }} className="small">
            {o.financialStatus ?? "—"}
          </div>
          <div style={{ flex: "0 0 160px" }} className="small">
            {o.fulfillmentStatus ?? "—"}
          </div>
          <div style={{ flex: "0 0 80px" }}>
            <Link className="primary" href={`/orders/${o.id}`}>View</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
