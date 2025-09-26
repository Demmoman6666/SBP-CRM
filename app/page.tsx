// app/page.tsx
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  // Optional: use the current user to gate tiles by role if you want
  const me = await getCurrentUser();
  const role = me?.role ?? null;

  // Decide which tiles to show (adjust if you want stricter gating)
  const canSeeSalesHub = true;              // everyone
  const canSeeReports = true;               // everyone
  const canSeeMarketing = true;             // tweak to roles if needed

  // Purchase Ordering tile (leave open to all for now; tighten if needed)
  const canSeePurchaseOrdering = true;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Welcome to the Salon Brands Pro CRM</h1>
        <p className="small">Use the tiles below to get started.</p>
      </section>

      <section className="home-actions">
        {canSeeSalesHub && (
          <Link href="/saleshub" className="action-tile">
            <div className="action-title">Sales Hub</div>
            <div className="action-sub">Customers &amp; Calls</div>
          </Link>
        )}

        {canSeeReports && (
          <Link href="/reports" className="action-tile">
            <div className="action-title">Reporting</div>
            <div className="action-sub">Call &amp; customer reporting</div>
          </Link>
        )}

        {canSeePurchaseOrdering && (
          <Link href="/purchase-ordering" className="action-tile">
            <div className="action-title">Purchase Ordering</div>
            <div className="action-sub">Forecast demand &amp; create POs</div>
          </Link>
        )}

        {canSeeMarketing && (
          <Link href="/marketing" className="action-tile">
            <div className="action-title">Marketing</div>
            <div className="action-sub">Campaigns, assets &amp; outreach</div>
          </Link>
        )}

        {/* Education tile intentionally moved into /saleshub */}
      </section>
    </div>
  );
}
