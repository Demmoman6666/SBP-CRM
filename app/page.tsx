// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header + quick actions row */}
      <section
        className="row"
        style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}
      >
        <div className="card" style={{ flex: 1 }}>
          <h1>Welcome to the Salon Brands Pro CRM</h1>
          <p className="small">Use the tiles below to get started.</p>
        </div>

        {/* Quick actions */}
        <aside className="card" style={{ width: 320 }}>
          <div className="grid" style={{ gap: 10 }}>
            <Link href="/sales-reps/new" className="primary" style={{ width: "100%" }}>
              Add a Sales Rep
            </Link>
            <Link href="/brands/new" className="primary" style={{ width: "100%" }}>
              Add a Competitor Brand
            </Link>
            <Link href="/stocked-brands/new" className="primary" style={{ width: "100%" }}>
              Add a Stocked Brand
            </Link>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            New Sales Reps and Brands will appear in the Create Customer form automatically.
          </p>
        </aside>
      </section>

      {/* Existing action tiles (unchanged) */}
      <section className="home-actions">
        <Link href="/customers/new" className="action-tile">
          <div className="action-title">New Customer</div>
          <div className="action-sub">Create a new customer profile</div>
        </Link>

        <Link href="/customers" className="action-tile">
          <div className="action-title">Customers</div>
          <div className="action-sub">Search & update customers</div>
        </Link>

        <Link href="/calls/new" className="action-tile">
          <div className="action-title">Log Call</div>
          <div className="action-sub">Capture a call with a customer/lead</div>
        </Link>

        <Link href="/calls" className="action-tile">
          <div className="action-title">View Call Log</div>
          <div className="action-sub">Live calls with powerful filters</div>
        </Link>
      </section>
    </div>
  );
}

