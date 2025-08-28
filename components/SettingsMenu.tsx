// components/SettingsMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type PanelKey = "rep" | "brand" | "stocked" | null;

export default function SettingsMenu() {
  // Hide completely on /login to avoid any chance of interfering with the auth page
  if (typeof window !== "undefined" && window.location.pathname === "/login") {
    return null;
  }

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PanelKey>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Ensure we only touch DOM / run effects after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close when clicking outside
  useEffect(() => {
    if (!mounted) return;
    function onDocClick(e: MouseEvent) {
      try {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          setOpen(false);
          setActive(null);
          setMsg(null);
        }
      } catch {
        // swallow
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [mounted]);

  // Ask who I am (admin?) after mount
  useEffect(() => {
    if (!mounted) return;
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        if (!r.ok) {
          setIsAdmin(false);
          return;
        }
        const j = await r.json().catch(() => null);
        setIsAdmin(j?.role === "ADMIN");
      } catch {
        setIsAdmin(false);
      }
    })();
  }, [mounted]);

  async function handleLogout() {
    setMsg(null);
    setLoggingOut(true);
    try {
      // Primary path
      const r = await fetch("/api/auth/logout", { method: "POST" });
      if (!r.ok) {
        // Backwards-compat path if you kept /api/logout
        await fetch("/api/logout", { method: "POST" });
      }
      // Go to login; middleware will treat us as signed out
      window.location.href = "/login";
    } catch (e: any) {
      setMsg(e?.message || "Failed to sign out");
      setLoggingOut(false);
    }
  }

  async function handleAddRep(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    const email = (String(formData.get("email") || "").trim() || null) as string | null;
    if (!name) return setMsg("Sales rep name is required.");

    try {
      const res = await fetch("/api/salesreps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (res.ok) {
        (document.getElementById("rep-form") as HTMLFormElement | null)?.reset();
        setMsg("Sales rep added ✔");
      } else {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error || "Failed to add sales rep.");
      }
    } catch {
      setMsg("Failed to add sales rep.");
    }
  }

  async function handleAddCompetitorBrand(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    if (!name) return setMsg("Brand name is required.");
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        (document.getElementById("brand-form") as HTMLFormElement | null)?.reset();
        setMsg("Competitor brand added ✔");
      } else {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error || "Failed to add competitor brand.");
      }
    } catch {
      setMsg("Failed to add competitor brand.");
    }
  }

  async function handleAddStockedBrand(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    if (!name) return setMsg("Stocked brand name is required.");
    try {
      const res = await fetch("/api/stocked-brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        (document.getElementById("stocked-brand-form") as HTMLFormElement | null)?.reset();
        setMsg("Stocked brand added ✔");
      } else {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error || "Failed to add stocked brand.");
      }
    } catch {
      setMsg("Failed to add stocked brand.");
    }
  }

  // Simple menu item styling
  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "#fff",
    textDecoration: "none",
    color: "inherit",
  };

  if (!mounted) return null;

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
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="#111" strokeWidth="1.5" />
          <path d="M19.4 15a7.9 7.9 0 0 0 .1-2l1.9-1.4-2-3.4-2.2.7a8 8 0 0 0-1.7-1l-.4-2.3h-4l-.4 2.3a8 8 0 0 0-1.7 1l-2.2-.7-2 3.4L4.5 13a7.9 7.9 0 0 0 .1 2l-1.9 1.4 2 3.4 2.2-.7c.5.4 1.1.7 1.7 1l.4 2.3h4l.4-2.3c.6-.3 1.2-.6 1.7-1l2.2.7 2-3.4-1.9-1.4Z" stroke="#111" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            marginTop: 8,
            width: 340,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            boxShadow: "var(--shadow)",
            padding: 12,
            zIndex: 50,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid" style={{ gap: 10 }}>
            {/* ---- Navigation shortcuts ---- */}
            <div className="small muted" style={{ padding: "2px 2px 0" }}>Navigation</div>
            <Link href="/settings" style={itemStyle} onClick={() => setOpen(false)}>
              <span>⚙️</span>
              <span>Settings Home</span>
            </Link>
            <Link href="/settings/account" style={itemStyle} onClick={() => setOpen(false)}>
              <span>👤</span>
              <span>Account Settings</span>
            </Link>

            {/* ---- Global Settings (admin only) ---- */}
            <div className="small muted" style={{ padding: "8px 2px 0" }}>Global Settings</div>
            {!isAdmin && (
              <div className="small muted">You need admin access to edit global settings.</div>
            )}
            {isAdmin && (
              <>
                <Link href="/settings/users" style={itemStyle} onClick={() => setOpen(false)}>
                  <span>👥</span>
                  <span>User Management</span>
                </Link>
                <Link href="/settings/users/new" style={itemStyle} onClick={() => setOpen(false)}>
                  <span>➕</span>
                  <span>Add New User</span>
                </Link>

                <div className="small muted" style={{ padding: "6px 2px 0" }}>Quick Add</div>

                {/* Add Sales Rep */}
                <button
                  className="primary"
                  onClick={() => { setActive(active === "rep" ? null : "rep"); setMsg(null); }}
                >
                  Add a Sales Rep
                </button>
                {active === "rep" && (
                  <form
                    id="rep-form"
                    className="grid"
                    style={{ gap: 8 }}
                    onSubmit={(e) => { e.preventDefault(); handleAddRep(new FormData(e.currentTarget)); }}
                  >
                    <div className="field">
                      <label>Name*</label>
                      <input name="name" required />
                    </div>
                    <div className="field">
                      <label>Email</label>
                      <input type="email" name="email" />
                    </div>
                    <div className="right">
                      <button type="submit" className="primary">Save Rep</button>
                    </div>
                  </form>
                )}

                {/* Add Competitor Brand */}
                <button
                  className="primary"
                  onClick={() => { setActive(active === "brand" ? null : "brand"); setMsg(null); }}
                >
                  Add a Competitor Brand
                </button>
                {active === "brand" && (
                  <form
                    id="brand-form"
                    className="grid"
                    style={{ gap: 8 }}
                    onSubmit={(e) => { e.preventDefault(); handleAddCompetitorBrand(new FormData(e.currentTarget)); }}
                  >
                    <div className="field">
                      <label>Brand Name*</label>
                      <input name="name" required />
                    </div>
                    <div className="right">
                      <button type="submit" className="primary">Save Competitor Brand</button>
                    </div>
                  </form>
                )}

                {/* Add Stocked Brand */}
                <button
                  className="primary"
                  onClick={() => { setActive(active === "stocked" ? null : "stocked"); setMsg(null); }}
                >
                  Add a Stocked Brand
                </button>
                {active === "stocked" && (
                  <form
                    id="stocked-brand-form"
                    className="grid"
                    style={{ gap: 8 }}
                    onSubmit={(e) => { e.preventDefault(); handleAddStockedBrand(new FormData(e.currentTarget)); }}
                  >
                    <div className="field">
                      <label>Stocked Brand Name*</label>
                      <input name="name" required />
                    </div>
                    <div className="right">
                      <button type="submit" className="primary">Save Stocked Brand</button>
                    </div>
                  </form>
                )}
              </>
            )}

            {/* Divider */}
            <div style={{ height: 1, background: "#e5e7eb", margin: "6px 0" }} />

            {/* Sign out */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              style={{
                width: "100%",
                borderRadius: 8,
                padding: "8px 10px",
                border: "1px solid #fca5a5",
                background: loggingOut ? "#fef2f2" : "#fee2e2",
                color: "#991b1b",
                fontWeight: 600,
              }}
              aria-label="Sign out"
              title="Sign out"
            >
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>

            {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
            <div className="small muted">
              New Sales Reps, Competitor Brands and Stocked Brands will be available in forms automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
