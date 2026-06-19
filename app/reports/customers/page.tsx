// app/reports/customers/page.tsx
export default function CustomerReportsPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Customer Reports</h1>
        <p className="small">Drill into customer activity, spend and gaps.</p>
      </section>

      <section className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        <div className="card">
          <b>GAP Analysis</b>
          <p className="small">See which customers are buying which brands — and which products they're missing. Filter by brand or drill into individual products.</p>
          <a className="primary" href="/reports/customers/gap-analysis" style={{ marginTop: 8 }}>Open</a>
        </div>

        <div className="card">
          <b>Customer Drop-off</b>
          <p className="small">Which accounts haven't ordered in X days.</p>
          <a className="primary" href="/reports/customers/drop-off" style={{ marginTop: 8 }}>Open</a>
        </div>

        <div className="card">
          <b>Sales by Customer</b>
          <p className="small">Gross, discounts, net &amp; margin.</p>
          <a className="primary" href="/reports/sales-by-customer" style={{ marginTop: 8 }}>Open</a>
        </div>

        <div className="card">
          <b>Stock &amp; Order Forecast</b>
          <p className="small">Suggest monthly PAR per SKU by customer &amp; brand.</p>
          <a className="primary" href="/reports/customers/stock-order-par" style={{ marginTop: 8 }}>Open</a>
        </div>
      </section>
    </div>
  );
}
