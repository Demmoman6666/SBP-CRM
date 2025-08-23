// components/SettingsMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<"rep" | "brand" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActive(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  async function handleAddRep(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim() || null;
    if (!name) return setMsg("Sales rep name is required.");

    const res = await fetch("/api/salesreps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (res.ok) {
      (document.getElementById("rep-form") as HTMLFormElement)?.reset();
      setMsg("Sales rep added ✔");
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error || "Failed to add sales rep.");
    }
  }

  async function handleAddBrand(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    if (!name) return setMsg("Brand name is required.");

    const res = await fetch("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      (document.getElementById("brand-form") as HTMLFormElement)?.reset();
      setMsg("Brand added ✔");
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error || "Failed to add brand.");
    }
  }

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        aria-label="Settings"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setActive(null);
          setMsg(null);
        }}
        className="btn"
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: "8px 10px",
        }}
      >
        {/* Gear icon */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="#111" strokeWidth="1.5"/>
          <path d="M19.4 15a7.9 7.9 0 0 0 .1-2l1.9-1.4-2-3.4-2.2.7a8 8 0 0 0-1.7-1l-.4-2.3h-4l-.4 2.3a8 8 0 0 0-1.7 1l-2.2-.7-2 3.4L4.5 13a7.9 7.9 0 0 0 .1 2l-1.9 1.4 2 3.4 2.2-.7c.5.4 1.1.7 1.7 1l.4 2.3h4l.4-2.3c.6-.3 1.2-.6 1.7-1l2.2.7 2-3.4-1.9-1.4Z" stroke="#111" strokeWidth="1.5"/>
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            marginTop: 8,
            width: 320,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            boxShadow: "var(--shadow)",
            padding: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid" style={{ gap: 8 }}>
            <button
              className="primary"
              onClick={() => { setActive(active === "rep" ? null : "rep"); setMsg(null); }}
            >
              Add a Sales Rep
            </button>
            {active === "rep" && (
              <form id="rep-form" className="grid" style={{ gap: 8 }}
                    onSubmit={(e) => { e.preventDefault(); handleAddRep(new FormData(e.currentTarget)); }}>
                <div>
                  <label>Name*</label>
                  <input name="name" required />
                </div>
                <div>
                  <label>Email</label>
                  <input type="email" name="email" />
                </div>
                <div className="right">
                  <button type="submit" className="primary">Save Rep</button>
                </div>
              </form>
            )}

            <button
              className="primary"
              onClick={() => { setActive(active === "brand" ? null : "brand"); setMsg(null); }}
            >
              Add a Brand
            </button>
            {active === "brand" && (
              <form id="brand-form" className="grid" style={{ gap: 8 }}
                    onSubmit={(e) => { e.preventDefault(); handleAddBrand(new FormData(e.currentTarget)); }}>
                <div>
                  <label>Brand Name*</label>
                  <input name="name" required />
                </div>
                <div className="right">
                  <button type="submit" className="primary">Save Brand</button>
                </div>
              </form>
            )}

            {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
            <div className="small muted">New Sales Reps and Brands will appear in the Create Customer form automatically.</div>
          </div>
        </div>
      )}
    </div>
  );
}
