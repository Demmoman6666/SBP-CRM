// app/(auth)/login/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMemo } from "react";

export default function LoginPage() {
  const params = useSearchParams();

  // If /api/login redirects back with ?error=...
  const error = params.get("error");
  // Allow deep-links like /login?redirect=/reports
  const redirect = params.get("redirect") || "/";

  const niceError = useMemo(() => {
    if (!error) return null;
    try {
      return decodeURIComponent(error);
    } catch {
      return error;
    }
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(1200px 600px at 50% -10%, #f1f5f9 0%, #ffffff 60%)",
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 440,
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        {/* Brand header */}
        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              aria-hidden
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background:
                  "linear-gradient(135deg, #111827 0%, #1f2937 60%, #374151 100%)",
              }}
            />
            <div>
              <h2 style={{ margin: 0 }}>Salon Brands Pro</h2>
              <div className="small muted" style={{ marginTop: 2 }}>
                Staff sign-in
              </div>
            </div>
          </div>

          {niceError && (
            <div
              role="alert"
              className="small"
              style={{
                marginTop: 6,
                color: "#991b1b",
                background: "#fee2e2",
                border: "1px solid #fecaca",
                padding: "8px 10px",
                borderRadius: 8,
              }}
            >
              {niceError}
            </div>
          )}
        </div>

        <form
          method="post"
          action="/api/login"
          className="grid"
          style={{ gap: 12 }}
        >
          {/* preserve redirect target */}
          <input type="hidden" name="redirect" value={redirect} />

          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              name="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              name="password"
              placeholder="Your password"
              autoComplete="current-password"
              minLength={8}
              required
            />
          </div>

          <div
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <label className="small row" style={{ gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="remember" value="1" />
              Remember me
            </label>

            {/* Optional future route */}
            <Link
              href="/forgot-password"
              className="small"
              style={{ textDecoration: "underline" }}
            >
              Forgot password?
            </Link>
          </div>

          <button className="primary" type="submit" style={{ marginTop: 4 }}>
            Sign in
          </button>
        </form>

        <p className="small muted" style={{ marginTop: 12 }}>
          By signing in you agree to the Salon Brands Pro terms &amp; policies.
        </p>
      </div>
    </div>
  );
}
