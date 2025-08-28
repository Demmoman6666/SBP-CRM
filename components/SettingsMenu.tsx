// components/SettingsMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type PanelKey = "rep" | "brand" | "stocked" | null;

export default function SettingsMenu() {
  const pathname = usePathname();

  // gate the whole menu behind auth
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PanelKey>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // 1) Never show on the login page
  const onLoginPage = pathname === "/login";
  // Early bail if we know it's the login page
  if (onLoginPage) return null;

  // 2) Check auth + role (hides the menu entirely if not logged in)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("unauth");
        const j = await r.json();
        if (!cancelled) {
          setAuthed(true);
          setIsAdmin(j?.role === "ADMIN");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthed(false);
          setIsAdmin(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide the button while loading or if unauthenticated
  if (authed !== true) return null;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActive(null);
        setMsg(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  async function handleLogout() {
    setMsg(null);
    setLoggingOut(true);
    try {
      // prefer new path; fall back to legacy if present
      const res =
        (await fetch("/api/auth/logout", { method: "POST" })) ||
        (await fetch("/api/logout", { method: "POST" }));

      // ignore body; just reload to clear UI and hit middleware
      window.location.href = "/login";
    } catch {
      // even if API hiccups, force a reload; middleware will redirect if cookie is gone
      window.location.href = "/login";
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleAddRep(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    const email = (String(formData.get("email") || "").trim() || null) as string | null;
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

  async function handleAddCompetitorBrand(formData: FormData) {
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
      setMsg("Competitor brand added ✔");
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error || "Failed to add competitor brand.");
    }
  }

  async function handleAddStockedBrand(formData: FormData) {
    setMsg(null);
    const name = String(formData.get("name") || "").trim();
    if (!name) return setMsg("Stocked brand name is required.");

    const res = await fetch("/api/stocked-brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      (document.getElementById("stocked-brand-form") as HTMLFormElement)?.reset();
      setMsg("Stocked brand added ✔");
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error || "Failed to add stocked brand.");
    }
  }

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
            {/* Navigation */}
            <div className="small muted" style={{ padding: "2px 2px 0" }}>Navigation</div>
            <Link href="/settings" style={itemStyle} onClick={() => setOpen(false)}>
              <span>⚙️</span>
              <span>Settings Home</span>
            </Link>
            <Link href="/settings/account" style={itemStyle} onClick={() => setOpen(false)}>
              <span>👤</span>
              <span>Account Settings</span>
            </Link>

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
              </>
            )}

            <div style={{ height: 1, background: "#e5e7eb", margin: "6px 0" }} />

            {/* Global Settings (admin-only quick adds) */}
            <div className="small muted" style={{ padding: "2px 2px 0" }}>Global Settings</div>
            {!isAdmin && (
              <div className="small muted" style={{ padding: "0 2px 4px" }}>
                You need admin access to edit global settings.
              </div>
            )}

            {isAdmin && (
              <>
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

            {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}

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

            <div className="small muted">
              New Sales Reps, Competitor Brands and Stocked Brands will be available in forms automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
