"use client";

import { useState } from "react";

export default function AiBriefPanel({ customerId, salonName }: { customerId: string; salonName: string }) {
  const [mode, setMode] = useState<"precall" | "snapshot" | null>(null);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);

  function generate(selectedMode: "precall" | "snapshot") {
    setMode(selectedMode);
    setBrief("");
    setError(null);
    setLoading(true);
    fetch("/api/ai/precall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, mode: selectedMode }),
    })
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error);
        setBrief(j.brief || "");
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function downloadPdf() {
    const win = window.open("", "_blank");
    if (!win) return;
    const title = mode === "snapshot" ? "Business Snapshot - " + salonName : "Pre-Call Brief - " + salonName;
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const safeBrief = brief.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = [
      "<!DOCTYPE html><html><head><title>" + title + "</title>",
      "<style>",
      "body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #111; }",
      "h1 { font-size: 1.4rem; border-bottom: 2px solid #FEB3E4; padding-bottom: 8px; }",
      ".meta { color: #666; font-size: 0.85rem; margin-bottom: 20px; }",
      "pre { white-space: pre-wrap; font-family: Arial, sans-serif; line-height: 1.7; font-size: 0.9rem; }",
      "</style></head><body>",
      "<h1>" + title + "</h1>",
      "<div class='meta'>Generated: " + date + " | Salon Brands Pro CRM</div>",
      "<pre>" + safeBrief + "</pre>",
      "<scr" + "ipt>window.onload = function() { window.print(); }</scr" + "ipt>",
      "</body></html>",
    ].join("");
    win.document.write(html);
    win.document.close();
  }

  return (
    <section className="card">
      <h2 style={{ marginBottom: 4 }}>AI Brief</h2>
      <p className="small muted" style={{ marginBottom: 16 }}>Choose the type of brief you need for {salonName}.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div
          onClick={() => !loading && generate("precall")}
          style={{ padding: "16px", border: mode === "precall" ? "2px solid var(--pink)" : "1px solid var(--border)", borderRadius: 12, cursor: "pointer", background: mode === "precall" ? "var(--pink-light)" : "#fff" }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4, color: mode === "precall" ? "var(--pink-dark)" : "var(--text)" }}>Pre-Call Brief</div>
          <div className="small muted">Quick intelligence brief before a visit. Visit objective, account status, opportunity, talking points and watch-outs.</div>
        </div>
        <div
          onClick={() => !loading && generate("snapshot")}
          style={{ padding: "16px", border: mode === "snapshot" ? "2px solid var(--pink)" : "1px solid var(--border)", borderRadius: 12, cursor: "pointer", background: mode === "snapshot" ? "var(--pink-light)" : "#fff" }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4, color: mode === "snapshot" ? "var(--pink-dark)" : "var(--text)" }}>Business Snapshot</div>
          <div className="small muted">Full account analysis. Revenue trends, brand penetration, GAP analysis, opportunities and recommended actions.</div>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Generating {mode === "snapshot" ? "business snapshot" : "pre-call brief"}...</p>
          <p className="small muted">Reading call history, orders and account data. This takes 15-30 seconds.</p>
        </div>
      )}

      {error && (
        <div className="small" style={{ color: "var(--red)", padding: "10px 14px", background: "#fee2e2", borderRadius: 8, marginBottom: 12 }}>{error}</div>
      )}

      {brief && !loading && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{mode === "snapshot" ? "Business Snapshot" : "Pre-Call Brief"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => navigator.clipboard?.writeText(brief)}>Copy</button>
              <button className="primary" style={{ fontSize: "0.8rem" }} onClick={downloadPdf}>Download PDF</button>
              <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => generate(mode!)}>Regenerate</button>
              <button className="btn" style={{ fontSize: "0.8rem" }} onClick={() => { setBrief(""); setMode(null); }}>Close</button>
            </div>
          </div>
          <div style={{ background: "#fafbfc", border: "1px solid var(--border)", borderRadius: 10, padding: "16px", fontSize: "0.875rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {brief}
          </div>
        </div>
      )}
    </section>
  );
}
