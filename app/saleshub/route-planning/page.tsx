// app/saleshub/route-planning/page.tsx
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function RoutePlanningHub() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Route Planning</h1>
        <p className="small">Choose a tool below.</p>
      </section>

      <section className="card">
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <Link href="/saleshub/route-planner" className="action-tile">
            <div className="action-title">Route Planner</div>
            <div className="action-sub">Filter by rep &amp; postcode; export</div>
          </Link>

          <Link href="/saleshub/route-plan" className="action-tile">
            <div className="action-title">Route Plan</div>
            <div className="action-sub">Pick rep → week → day</div>
          </Link>
        </div>
      </section>
    </div>
  );
}
