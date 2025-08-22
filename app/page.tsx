// app/page.tsx
export default function Home() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>Welcome 👋</h2>
        <p className="small">Create or find a customer to get started.</p>
        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <a className="button" href="/customers/new">Create Customer</a>
          <a className="link" href="/customers">Search / List Customers</a>
        </div>
      </div>
    </div>
  );
}
