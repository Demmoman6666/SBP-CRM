// components/SettingsMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function SettingsMenu() {
  const [mounted, setMounted] = useState(false);
  const [hideOnLogin, setHideOnLogin] = useState(false);
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mount-only effects & hide on /login
  useEffect(() => {
    setMounted(true);
    try {
      if (typeof window !== "undefined" && window.location.pathname === "/login") {
        setHideOnLogin(true);
      }
    } catch {}
  }, []);

  // Close panel when clicking outside
  useEffect(() => {
    if (!mounted) return;
    function onDocClick(e: MouseEvent) {
      try {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          setOpen(false);
          setMsg(null);
        }
      } catch {}
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [mounted]);

  // Fetch current user → show admin links if applicable
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
        // Back-compat if /api/logout exists
        await fetch("/api/logout", { method: "POST" });
      }
      window.location.href = "/login";
    } catch (e: any) {
      setMsg(e?.message || "Failed to sign out");
      setLoggingOut(false);
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

  if (!mounted || hideOnLogin) return null;

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
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
          role="menu"
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

            {/* 🔻 Removed Settings Home link */}
            {/* <Link href="/settings" ...>Settings Home</Link> */}

            <Link href="/settings/account" style={itemStyle} onClick={() => setOpen(false)}>
              <span>👤</span>
              <span>Account Settings</span>
            </Link>

            {/* Global Settings */}
            <div className="small muted" style={{ padding: "8px 2px 0" }}>Global Settings</div>
            {!isAdmin && (
              <div className="small muted">You need admin access to edit global settings.</div>
            )}
            {isAdmin && (
              <>
                <Link href="/settings/global/stocked-brands" style={itemStyle} onClick={() => setOpen(false)}>
                  <span>🏷️</span>
                  <span>Toggle Stocked Brands</span>
                </Link>
                <Link href="/settings/global/competitor-brands" style={itemStyle} onClick={() => setOpen(false)}>
                  <span>🆚</span>
                  <span>Toggle Competitor Brands</span>
                </Link>
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
          </div>
        </div>
      )}
    </div>
  );
}
