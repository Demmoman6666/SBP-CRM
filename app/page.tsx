// app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Welcome to the Salon Brands Pro CRM</h1>
        <p className="small">Use the tiles below to get started.</p>
      </section>

      <section className="home-actions">
        <Link href="/sales-hub" className="action-tile">
          <div className="action-title">Sales Hub</div>
          <div className="action-sub">Customers, calls &amp; more</div>
        </Link>

        <Link href="/reports" className="action-tile">
          <div className="action-title">Reporting</div>
          <div className="action-sub">Call &amp; customer reporting</div>
        </Link>
      </section>
    </div>
  );
}
