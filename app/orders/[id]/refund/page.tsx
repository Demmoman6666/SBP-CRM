// app/orders/[id]/refund/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

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

  const currency = (order.currency || "GBP").toUpperCase();

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
          // expose values to the inline calculator
          data-vat-rate={VAT_RATE}
          data-currency={currency}
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
                    name={`qty_${li.id}`}     // parsed by the refund API
                    min={0}
                    max={li.quantity}
                    defaultValue={0}
                    step={1}
                    style={{ width: 90 }}
                    // used by the inline calculator
                    data-refund-qty
                    data-unit-net={Number(li.price ?? 0)}
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

          {/* Live refund summary */}
          <div className="card" style={{ background: "#fafafa" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <b>Refund summary</b>
              <div style={{ textAlign: "right" }}>
                <div className="small">Net: <b id="refund-net">—</b></div>
                <div className="small">VAT ({Math.round(VAT_RATE * 100)}%): <b id="refund-vat">—</b></div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>
                  Total to refund: <span id="refund-total">—</span>
                </div>
              </div>
            </div>
          </div>

          <div className="right row" style={{ gap: 8 }}>
            <Link className="btn" href={`/orders/${order.id}`}>Cancel</Link>
            <button className="primary" type="submit">Process refund</button>
          </div>
        </form>
      </div>
      {/* Inline calculator script (keeps this page single-file, server-rendered) */}
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
(function(){
  const form = document.querySelector('form[action$="/api/orders/${order.id}/refund"]');
  if(!form) return;

  const vatRate = Number(form.getAttribute('data-vat-rate') || '0.20');
  const currency = form.getAttribute('data-currency') || 'GBP';

  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });

  function recalc(){
    let net = 0;
    document.querySelectorAll('input[data-refund-qty]').forEach(function(el){
      const input = el;
      const q = Number(input.value || 0);
      const unit = Number(input.getAttribute('data-unit-net') || 0);
      if (Number.isFinite(q) && Number.isFinite(unit) && q > 0) {
        net += unit * q;
      }
    });
    const vat = net * vatRate;
    const gross = net + vat;
    const byId = id => document.getElementById(id);
    if (byId('refund-net')) byId('refund-net').textContent = fmt.format(net);
    if (byId('refund-vat')) byId('refund-vat').textContent = fmt.format(vat);
    if (byId('refund-total')) byId('refund-total').textContent = fmt.format(gross);
  }

  // bind events
  form.querySelectorAll('input[data-refund-qty]').forEach(function(el){
    ['input','change','keyup'].forEach(evt => el.addEventListener(evt, recalc));
  });

  // initial
  recalc();
})();
          `,
        }}
      />
    </div>
  );
}
