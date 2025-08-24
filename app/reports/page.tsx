// app/reports/page.tsx
import Link from "next/link";

export default function ReportsHub() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Reports</h1>
        <p className="small">Choose a report to view insights.</p>
      </section>

      <section className="home-actions">
        <Link href="/reports/calls" className="action-tile">
          <div className="action-title">Call Report</div>
          <div className="action-sub">Volumes, bookings &amp; conversion</div>
        </Link>

        <Link href="/reports/customers" className="action-tile">
          <div className="action-title">Customer Report</div>
          <div className="action-sub">(Coming soon)</div>
        </Link>
      </section>
    </div>
  );
}
