// app/saleshub/page.tsx
import Link from "next/link";
import PipelineTile from "@/components/PipelineTile";

export const dynamic = "force-static";
export const revalidate = 1;

export default function SalesHubPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Sales Hub</h1>
        <p className="small">Everything for customer management and call logging.</p>
      </section>

      <section className="home-actions">
        <Link href="/customers/new" className="action-tile">
          <div className="action-title">New Customer</div>
          <div className="action-sub">Create a new customer profile</div>
        </Link>

        <Link href="/customers" className="action-tile">
          <div className="action-title">Customers</div>
          <div className="action-sub">Search &amp; update customers</div>
        </Link>

        <Link href="/calls/new" className="action-tile">
          <div className="action-title">Log Call</div>
          <div className="action-sub">Capture a call with a customer/lead</div>
        </Link>

        <Link href="/calls" className="action-tile">
          <div className="action-title">View Call Log</div>
          <div className="action-sub">Live calls with powerful filters</div>
        </Link>

        {/* Profit Calculator */}
        <Link href="/tools/profit-calculator" className="action-tile">
          <div className="action-title">Profit Calculator</div>
          <div className="action-sub">Model margins &amp; profit</div>
        </Link>
      </section>

      {/* Pipeline tile (counts + table) */}
      <PipelineTile />
    </div>
  );
}
