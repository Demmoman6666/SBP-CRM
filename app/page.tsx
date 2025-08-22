export default function Page() {
  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="card">
        <h2>Welcome 👋</h2>
        <p className="small">
          Use the links above to <b>Create</b> a new customer or <b>Search</b> existing customers.
        </p>
      </div>
      <div className="card">
        <h3>Tip</h3>
        <p className="small">Everything is kept intentionally simple: one access code login, basic forms, and notes/visit logs.</p>
      </div>
    </div>
  );
}
