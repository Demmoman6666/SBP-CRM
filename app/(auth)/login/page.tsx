// app/(auth)/login/page.tsx
"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic"; // No `revalidate` export here

function LoginInner() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const msg = params.get("m") || params.get("error") || "";
  const [showPw, setShowPw] = useState(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(1000px 600px at 85% -10%, #f0f9ff 0%, transparent 60%), radial-gradient(800px 500px at -10% 110%, #fef3c7 0%, transparent 60%)",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 20,
          borderRadius: 16,
          boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
          background: "#fff",
        }}
      >
        {/* Brand header */}
        <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg,#111827 0%,#374151 50%,#111827 100%)",
              display: "grid",
              placeItems: "center",
              color: "white",
              fontWeight: 800,
              letterSpacing: 0.3,
            }}
          >
            SB
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Salon Brands Pro</h2>
            <div className="small muted" style={{ marginTop: 2 }}>Staff Sign-in</div>
          </div>
        </div>

        {msg ? (
          <div
            className="small"
            style={{
              margin: "8px 0 12px",
              padding: "8px 10px",
              borderRadius: 10,
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
            }}
          >
            {msg}
          </div>
        ) : null}

        <form method="post" action="/api/login" className="grid" style={{ gap: 10 }}>
          <input type="hidden" name="next" value={next} />

          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              name="email"
              placeholder="you@salonbrandspro.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>Password</label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                type={showPw ? "text" : "password"}
                name="password"
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="btn"
                style={{ position: "absolute", right: 6, top: 6, padding: "6px 8px", borderRadius: 8 }}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button className="primary" type="submit" style={{ marginTop: 4 }}>
            Sign in
          </button>

          <div className="small muted" style={{ marginTop: 6 }}>
            Trouble signing in? Contact your admin.
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
