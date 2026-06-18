// components/SettingsMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function SettingsMenu() {
  const [mounted, setMounted] = useState(false);
  const [hideOnLogin, setHideOnLogin] = useState(false);
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      if (typeof window !== "undefined" && window.location.pathname === "/login") setHideOnLogin(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!mounted) return;
    function onDocClick(e: MouseEvent) {
      try {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) { setOpen(false); setMsg(null); }
      } catch {}
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        if (!r.ok) { setIsAdmin(false); return; }
        const j = await r.json().catch(() => null);
        setIsAdmin(j?.role === "ADMIN");
      } catch { setIsAdmin(false); }
    })();
  }, [mounted]);

  async function handleLogout() {
    setMsg(null); setLoggingOut(true);
    try {
      const r = await fetch("/api/auth/logout", { method: "POST" });
      if (!r.ok) await fetch("/api/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (e: any) { setMsg(e?.message || "Failed to sign out"); setLoggingOut(false); }
  }

  if (!mounted || hideOnLogin) return null;

  const SectionLabel = ({ label }: { label: string }) => (
    <div style={{ padding: "10px 4px 4px", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8" }}>
      {label}
    </div>
  );

  const MenuItem = ({ href, emoji, label, desc }: { href: string; emoji: string; label: string; desc?: string }) => (
    <Link
      href={href}
      onClick={() => setOpen(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, textDecoration: "none", color: "inherit" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ fontSize: "1rem", width: 24, textAlign: "center", flexShrink: 0 }}>{emoji}</span>
      <div>
        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 1 }}>{desc}</div>}
      </div>
    </Link>
  );

  const Divider = () => <div style={{ height: 1, background: "#f1f5f9", margin: "4px 0" }} />;

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setMsg(null); }}
        className="btn"
        style={{ background: open ? "#f1f5f9" : "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M19.4 15a7.9 7.9 0 0 0 .1-2l1.9-1.4-2-3.4-2.2.7a8 8 0 0 0-1.7-1l-.4-2.3h-4l-.4 2.3a8 8 0 0 0-1.7 1l-2.2-.7-2 3.4L4.5 13a7.9 7.9 0 0 0 .1 2l-1.9 1.4 2 3.4 2.2-.7c.5.4 1.1.7 1.7 1l.4 2.3h4l.4-2.3c.6-.3 1.2-.6 1.7-1l2.2.7 2-3.4-1.9-1.4Z" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{ position: "absolute", right: 0, marginTop: 8, width: 280, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.12)", padding: "8px", zIndex: 100 }}
          onClick={e => e.stopPropagation()}
        >
          <SectionLabel label="My Account" />
          <MenuItem href="/settings" emoji="👤" label="Account & Password" desc="Update your name, email, password" />

          {isAdmin && (
            <>
              <Divider />
              <SectionLabel label="People" />
              <MenuItem href="/settings?tab=reps" emoji="🧑‍💼" label="Sales Reps" desc="Add, edit or view rep profiles" />
              <MenuItem href="/settings/users" emoji="👥" label="Users" desc="Manage CRM user accounts" />
              <MenuItem href="/settings/users/new" emoji="➕" label="Add New User" desc="Create a new CRM login" />

              <Divider />
              <SectionLabel label="Brands & Products" />
              <MenuItem href="/settings/global/stocked-brands" emoji="🏷️" label="Brand Management" desc="Toggle brands for call log and reports" />
              <MenuItem href="/settings/global/competitor-brands" emoji="🆚" label="Competitor Brands" desc="Toggle competitor brands for call log" />

              <Divider />
              <SectionLabel label="Admin" />
              <MenuItem href="/settings?tab=admin" emoji="🔐" label="User Permissions" desc="Roles and feature access" />
              <MenuItem href="/settings?tab=tools" emoji="🔧" label="Admin Tools" desc="Bulk operations and data tools" />
            </>
          )}

          <Divider />
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            style={{ width: "100%", borderRadius: 8, padding: "10px 12px", border: "none", background: "transparent", color: "#dc2626", fontWeight: 600, fontSize: "0.875rem", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
            onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: "1rem", width: 24, textAlign: "center" }}>🚪</span>
            <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
          </button>

          {msg && <div className="small" style={{ padding: "4px 10px", color: "#dc2626" }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
