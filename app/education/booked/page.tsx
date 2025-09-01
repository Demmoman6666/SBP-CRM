// app/education/booked/page.tsx
export const dynamic = "force-static";
export const revalidate = 1;

export default function EducationBookedPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Education Booked</h1>
        <p className="small">All confirmed/scheduled education sessions.</p>
      </section>

      <section className="card">
        <p className="small muted">
          TODO: show upcoming sessions (date, rep/trainer, location, customer).
        </p>
      </section>
    </div>
  );
}
