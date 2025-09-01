// app/page.tsx
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  // Optional: use the current user to gate tiles by role if you want
  const me = await getCurrentUser();
  const role = me?.role ?? null;

  // Decide which tiles to show (adjust if you want stricter gating)
  const canSeeSalesHub   = true;              // everyone
  const canSeeReports    = true;              // everyone (set to role !== "VIEWER" if you want)
  const canSeeMarketing  = true;              // tweak to roles if needed
  const canSeeEducation  = true;              // tweak to roles if needed

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

        {/* NEW: Marketing */}
        {canSeeMarketing && (
          <Link href="/marketing" className="action-tile">
            <div className="action-title">Marketing</div>
            <div className="action-sub">Campaigns, assets &amp; outreach</div>
          </Link>
        )}

        {/* NEW: Education */}
        {canSeeEducation && (
          <Link href="/education" className="action-tile">
            <div className="action-title">Education</div>
            <div className="action-sub">Training, resources &amp; events</div>
          </Link>
        )}
      </section>
    </div>
  );
}
