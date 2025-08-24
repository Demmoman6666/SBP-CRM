// app/stocked-brands/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewStockedBrandPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Brand name is required.");
      return;
    }

    try {
      setSaving(true);
      // Reuse your existing brands API
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() /* , kind: "stocked" */ }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to create brand");
      }
      router.push("/");
    } catch (err: any) {
      setError(err?.message || "Failed to create brand");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container" style={{ paddingTop: 24, paddingBottom: 32 }}>
      <section className="card">
        <h1>Add a Stocked Brand</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          This brand will appear in forms that use the brands list.
        </p>

        <form onSubmit={onSubmit} className="grid" style={{ gap: 12, marginTop: 12, maxWidth: 520 }}>
          <div className="field">
            <label>Brand Name*</label>
            <input
              name="name"
              placeholder="e.g. Wella"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="right row" style={{ gap: 8 }}>
            <a href="/" className="btn" style={{ background: "#f3f4f6" }}>
              Cancel
            </a>
            <button className="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Brand"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
