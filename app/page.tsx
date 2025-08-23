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
          <div className="action-sub">Search & update customers</div>
        </Link>

        {/* NEW: Log Call tile */}
        <Link href="/calls/new" className="action-tile">
          <div className="action-title">Log Call</div>
          <div className="action-sub">Record a phone call and details</div>
        </Link>
      </section>
    </div>
  );
}
