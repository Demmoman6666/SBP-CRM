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

        {/* Sales Reports tile now *includes* Sales by Customer and links to it */}
        <Link href="/reports/sales-by-customer" className="action-tile">
          <div className="action-title">Sales Reports</div>
          <div className="action-sub">Spend, GAP analysis &amp; Sales by Customer</div>
        </Link>

        {/* Removed standalone Sales by Customer tile */}

        {/* Vendor Scorecard */}
        <Link href="/reports/vendors/scorecard" className="action-tile">
          <div className="action-title">Vendor Scorecard</div>
          <div className="action-sub">Revenue, orders, customers &amp; growth</div>
        </Link>

        <Link href="/reports/targets" className="action-tile">
          <div className="action-title">Targets &amp; Scorecards</div>
          <div className="action-sub">Monthly goals &amp; performance</div>
        </Link>

        {/* NEW: Rep Scorecard tile */}
        <Link href="/reports/rep-scorecard" className="action-tile">
          <div className="action-title">Rep Scorecard</div>
          <div className="action-sub">Individual performance</div>
        </Link>
      </section>
    </div>
  );
}
