// app/(auth)/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import logo from "@/public/sbp-logo.png"; // <- static import (file lives in /public)

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nextUrl, setNextUrl] = useState("/");

  // Read ?next=... without useSearchParams (avoids suspense warning)
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
      const fd = new FormData();
      fd.set("email", email.trim());
      fd.set("password", password);

      const res = await fetch("/api/login", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Sign-in failed");

      window.location.href = nextUrl; // cookie is set by API
    } catch (err: any) {
      setMsg(err?.message || "Sign-in failed");
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
        {/* Brand logo (centered) */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <Image
            src={logo}
            alt="Salon Brands Pro"
            height={28}
            priority
            style={{ height: 28, width: "auto" }}
          />
        </div>

        {/* Login form */}
        <form method="post" action="/api/login" onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
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

          {/* Progressive enhancement: if JS is disabled, the form still posts to /api/login */}
          <input type="hidden" name="__enhanced" value="1" />
        </form>
      </div>
    </div>
  );
}
