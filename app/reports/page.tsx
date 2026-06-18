import Link from "next/link";

export default function ReportsHub() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Reports</h1>
        <p className="small muted">All your key metrics in one place.</p>
      </section>

      <section className="home-actions">

        <Link href="/reports/ai" className="action-tile">
          <div className="action-title">✨ AI Report</div>
          <div className="action-sub">Claude analyses your call logs and writes a full performance report</div>
        </Link>

        <Link href="/reports/performance" className="action-tile">
          <div className="action-title">Performance Dashboard</div>
          <div className="action-sub">Calls, sales, conversions & customers — all reps or individual</div>
        </Link>

        <Link href="/reports/customers" className="action-tile">
          <div className="action-title">Customer Reports</div>
          <div className="action-sub">GAP analysis, drop-off, sales & PAR</div>
        </Link>

        <Link href="/reports/brand-penetration" className="action-tile">
          <div className="action-title">Brand Penetration</div>
          <div className="action-sub">Which customers stock which brands</div>
        </Link>

        <Link href="/reports/vendors/scorecard" className="action-tile">
          <div className="action-title">Vendor Scorecard</div>
          <div className="action-sub">Revenue, orders & growth by brand</div>
        </Link>

        <Link href="/reports/targets" className="action-tile">
          <div className="action-title">Targets</div>
          <div className="action-sub">Goals vs actuals</div>
        </Link>

      </section>
    </div>
  );
}
