// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h2>Welcome to the Salon Brands Pro CRM</h2>
        <p className="small">Use the actions below to get started.</p>
      </section>

      <section className="home-actions">
        <Link href="/customers" className="action-tile" aria-label="Go to Customers">
          <div className="action-title">Customers</div>
          <div className="action-sub">Browse & search</div>
        </Link>

        <Link href="/customers/new" className="action-tile" aria-label="Create a new customer">
          <div className="action-title">New Customer</div>
          <div className="action-sub">Create a profile</div>
        </Link>
      </section>
    </div>
  );
}
