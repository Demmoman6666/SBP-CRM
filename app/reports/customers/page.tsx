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
          <p className="small">Spend by customer & vendor, filterable by Sales Rep.</p>
          <a className="primary" href="/reports/customers/gap-analysis" style={{ marginTop: 8 }}>
            Open
          </a>
        </div>

        {/* Add other customer reports tiles here later */}
      </section>
    </div>
  );
}
