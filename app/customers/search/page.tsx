"use client";

import { useEffect, useState } from "react";

type Item = { id: string; salonName: string; customerName: string; town: string | null; email: string | null; createdAt: string };

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  async function run(query = "") {
    setLoading(true);
    const res = await fetch("/api/customers?q=" + encodeURIComponent(query));
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { run(""); }, []);

  return (
    <div className="card">
      <h2>Search Customers</h2>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input placeholder="Search by salon, person, email, town, customer number…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="primary" onClick={() => run(q)}>Search</button>
      </div>

      {loading ? <p className="small">Loading…</p> : (
        <table className="table">
          <thead><tr><th>Salon</th><th>Customer</th><th>Town</th><th>Email</th><th>Created</th></tr></thead>
          <tbody>
          {data.map(r => (
            <tr key={r.id}>
              <td><a href={`/customers/${r.id}`}>{r.salonName}</a></td>
              <td>{r.customerName}</td>
              <td>{r.town || "-"}</td>
              <td>{r.email || "-"}</td>
              <td>{new Date(r.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
