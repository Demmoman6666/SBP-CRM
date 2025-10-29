// app/reports/customers/page.tsx
export default function CustomerReportsPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Customer Reports</h1>
        <p className="small">Drill into customer activity, spend and gaps.</p>
      </section>

      <section
        className="grid"
        style={{ gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
      >
        <div className="card">
          <b>GAP Analysis</b>
          <p className="small">Spend by customer &amp; vendor, filterable by Sales Rep.</p>
          <a className="primary" href="/reports/customers/gap-analysis" style={{ marginTop: 8 }}>
            Open
          </a>
        </div>

        <div className="card">
          <b>Customer Drop-off</b>
          <p className="small">Which accounts haven’t ordered in X days.</p>
          <a className="primary" href="/reports/customers/drop-off" style={{ marginTop: 8 }}>
            Open
          </a>
        </div>

        {/* NEW: GAP Analysis (By Product) */}
        <div className="card">
          <b>GAP Analysis (By Product)</b>
          <p className="small">Pick a brand to see who has / hasn’t bought each product.</p>
          <a className="primary" href="/reports/gap-products" style={{ marginTop: 8 }}>
            Open
          </a>
        </div>

        {/* NEW: Sales by Customer */}
        <div className="card">
          <b>Sales by Customer</b>
          <p className="small">Gross, discounts, net &amp; margin.</p>
          <a className="primary" href="/reports/sales-by-customer" style={{ marginTop: 8 }}>
            Open
          </a>
        </div>

        {/* NEW: Stock & Order (PAR) */}
        <div className="card">
          <b>Stock &amp; Order (PAR)</b>
          <p className="small">Suggest monthly PAR per SKU by customer &amp; brand.</p>
          <a
            className="primary"
            href="/reports/customers/stock-order-par"
            style={{ marginTop: 8 }}
          >
            Open
          </a>
        </div>
      </section>
    </div>
  );
}
