// app/(auth)/login/page.tsx
"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nextUrl, setNextUrl] = useState("/");

  // read ?next=… without useSearchParams (avoids suspense warning)
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const p = url.searchParams.get("next");
      if (p && p.startsWith("/")) setNextUrl(p);
    } catch {}
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setSubmitting(true);

    try {
      // Send as form data so it works with our route that accepts JSON or form
      const fd = new FormData();
      fd.set("email", email.trim());
      fd.set("password", password);

      const res = await fetch("/api/login", {
        method: "POST",
        body: fd,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Sign-in failed");

      // success: cookie set by API; go to next/home
      window.location.href = nextUrl;
    } catch (err: any) {
      setMsg(err?.message || "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "linear-gradient(180deg,#f8fafc,#ffffff)" }}>
      <div className="card" style={{ width: 420, maxWidth: "90vw", padding: 20 }}>
        {/* Brand */}
        <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#111", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700 }}>
            SB
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>Salon Brands Pro</div>
            <div className="small muted">Staff Sign-in</div>
          </div>
        </div>

        {/* The form posts to /api/login with email & password */}
        <form method="post" action="/api/login" onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <div>
            <label>Email</label>
            <input
              name="email"
              type="email"
              className="input"
              placeholder="you@salonbrandspro.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div>
            <label>Password</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                name="password"
                type={show ? "text" : "password"}
                className="input"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          {msg && (
            <div className="small" style={{ color: "#b91c1c" }}>
              {msg}
            </div>
          )}

          <p className="small muted" style={{ marginTop: 6 }}>
            Trouble signing in? Contact your admin.
          </p>

          {/* Progressive enhancement: if JS is disabled, the form still posts to /api/login,
              but will show JSON. With JS enabled (onSubmit), we stay on the page and redirect. */}
          <input type="hidden" name="__enhanced" value="1" />
        </form>
      </div>
    </div>
  );
}
