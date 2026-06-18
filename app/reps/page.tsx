"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Rep = { id: string; name: string; email: string | null; phone: string | null; territory: string | null; };

export default function RepsPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/salesreps", { cache: "no-store" }).then((r) => r.json()).then(setReps).finally(() => setLoading(false));
  }, []);

  if (loading) return <section className="card"><p className="small">Loading…</p></section>;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Sales Reps</h1>
            <p className="small muted">{reps.length} rep{reps.length !== 1 ? "s" : ""}</p>
          </div>
          <Link href="/settings?tab=reps" className="btn primary">+ Manage Reps</Link>
        </div>
      </section>
      {reps.length === 0 ? (
        <section className="card"><p className="small muted">No sales reps found. Add them in Settings → Sales Reps.</p></section>
      ) : (
        <section className="home-actions">
          {reps.map((rep) => (
            <Link key={rep.id} href={`/reps/${rep.id}`} className="action-tile">
              <div className="action-title">{rep.name}</div>
              {rep.territory && <div className="action-sub">📍 {rep.territory}</div>}
              {rep.email && !rep.territory && <div className="action-sub">{rep.email}</div>}
              {rep.phone && <div className="action-sub" style={{ marginTop: 4, fontSize: "0.8rem" }}>📞 {rep.phone}</div>}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
