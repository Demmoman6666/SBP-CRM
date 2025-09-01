// app/education/page.tsx
export const dynamic = "force-static";
export const revalidate = 1;

export default function EducationPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Education</h1>
        <p className="small">Training resources and events for your team &amp; customers.</p>
      </section>

      <section className="home-actions">
        <div className="action-tile" style={{ cursor: "default" }}>
          <div className="action-title">Training Library</div>
          <div className="action-sub">Guides, videos &amp; manuals</div>
        </div>
        <div className="action-tile" style={{ cursor: "default" }}>
          <div className="action-title">Workshops</div>
          <div className="action-sub">Upcoming dates &amp; bookings</div>
        </div>
        <div className="action-tile" style={{ cursor: "default" }}>
          <div className="action-title">Certifications</div>
          <div className="action-sub">Track staff progress</div>
        </div>
      </section>
    </div>
  );
}
