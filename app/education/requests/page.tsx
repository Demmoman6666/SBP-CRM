// app/education/requests/page.tsx
export const dynamic = "force-static";
export const revalidate = 1;

export default function EducationRequestsPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Education Requested</h1>
        <p className="small">List of customers who’ve requested education.</p>
      </section>

      <section className="card">
        <p className="small muted">
          TODO: hook this up to your data (filters by date, rep, brand, etc.).
        </p>
      </section>
    </div>
  );
}
