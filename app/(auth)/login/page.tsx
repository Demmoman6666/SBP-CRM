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

  // Read ?next=... safely without useSearchParams
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "include", // make sure the Set-Cookie is honored
        body: JSON.stringify({
          email: email.trim(),
          password,
          remember: true,
          redirect: 0, // force JSON response from the API
        }),
      });

      const json = await res.json().catch(() => ({} as any));

      if (res.ok && json?.ok) {
        // Cookie was set by the API; go where we were headed
        window.location.replace(nextUrl);
        return;
      }

      // Show a clear reason if API rejected
      const reason =
        json?.error ||
        (res.status === 401 ? "Unauthorized" : res.status === 400 ? "Bad request" : "Login failed");
      setMsg(reason);
    } catch (err: any) {
      setMsg(err?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#fff",
        padding: 24,
      }}
    >
      <div className="card" style={{ width: 420, maxWidth: "90vw", padding: 20 }}>
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <div>
            <label className="sr-only">Email</label>
            <input
              name="email"
              type="email"
              className="input"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div>
            <label className="sr-only">Password</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                name="password"
                type={show ? "text" : "password"}
                className="input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
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
            <div className="small" style={{ color: "#b91c1c", textAlign: "center" }}>
              {msg}
            </div>
          )}

          <p className="small muted" style={{ marginTop: 6, textAlign: "center" }}>
            Trouble signing in? Contact your admin.
          </p>

          {/* Preserve target after login */}
          <input type="hidden" name="next" value={nextUrl} />
        </form>
      </div>
    </div>
  );
}
