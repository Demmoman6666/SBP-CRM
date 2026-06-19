"use client";

import { useState } from "react";

export default function RepReviewPanel({ repId, repName }: { repId: string; repName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState("");
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setReview("");
    fetch("/api/ai/rep-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repId }),
    })
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error);
        setReview(j.review || "");
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function renderReview(text: string) {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("## ")) {
        return <div key={i} style={{ fontWeight: 700, fontSize: "0.85rem", marginTop: 14, marginBottom: 4, color: "var(--pink-dark)" }}>{line.slice(3)}</div>;
      }
      if (line.startsWith("- ")) {
        return <div key={i} style={{ paddingLeft: 14, marginBottom: 3, fontSize: "0.875rem", lineHeight: 1.6 }}>{"\u2022 " + line.slice(2)}</div>;
      }
      if (line.trim() === "") return <div key={i} style={{ height: 4 }} />;
      return <div key={i} style={{ fontSize: "0.875rem", lineHeight: 1.6, marginBottom: 2 }}>{line}</div>;
    });
  }

  if (!open) {
    return (
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>AI Performance Review</h2>
            <p className="small muted">Get a quick AI-generated summary of {repName}'s last 30 days.</p>
          </div>
          <button className="primary" onClick={generate}>Generate Review</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>AI Performance Review</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {review && !loading && (
            <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => navigator.clipboard?.writeText(review)}>Copy</button>
          )}
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={generate} disabled={loading}>
            {loading ? "..." : "Regenerate"}
          </button>
          <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <p className="small muted">Analysing last 30 days of activity...</p>
        </div>
      )}

      {error && <div className="small" style={{ color: "var(--red)" }}>{error}</div>}

      {review && !loading && (
        <div style={{ background: "#fafbfc", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
          {renderReview(review)}
        </div>
      )}
    </section>
  );
}
