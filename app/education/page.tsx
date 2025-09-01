// app/education/page.tsx
import Link from "next/link";

export const dynamic = "force-static";
export const revalidate = 1;

export default function EducationPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Education</h1>
        <p className="small">Manage education requests and confirmed bookings.</p>
      </section>

      <section className="home-actions">
        <Link href="/education/requests" className="action-tile">
          <div className="action-title">Education Requested</div>
          <div className="action-sub">Leads asking for training</div>
        </Link>

        <Link href="/education/booked" className="action-tile">
          <div className="action-title">Education Booked</div>
          <div className="action-sub">Confirmed education sessions</div>
        </Link>
      </section>
    </div>
  );
}
