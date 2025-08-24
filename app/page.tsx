// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Welcome to the Salon Brands Pro CRM</h1>
        <p className="small">Use the tiles below to get started.</p>
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

        <Link href="/reports" className="action-tile">
          <div className="action-title">Reports</div>
          <div className="action-sub">Call &amp; customer reporting</div>
        </Link>
      </section>
    </div>
  );
}
