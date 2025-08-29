// components/GoogleCalendarConnect.tsx
"use client";
import { useEffect, useState } from "react";

type MeResponse = {
  googleConnected?: boolean;
  googleEmail?: string | null;
  googleCalendarId?: string | null;
  // Back-compat fallbacks if your /api/me ever returned these:
  me?: { googleEmail?: string | null };
  googleAccessToken?: string | null;
};

export default function GoogleCalendarConnect() {
  const [loading, setLoading] = useState(false);       // for the Connect/Reconnect button
  const [connected, setConnected] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        if (!r.ok) { if (!cancelled) setConnected(false); return; }
        const j: MeResponse = await r.json();

        const isConnected =
          typeof j.googleConnected === "boolean"
            ? j.googleConnected
            : Boolean(j.googleAccessToken || j.googleEmail || j.me?.googleEmail); // fallback

        if (cancelled) return;
        setConnected(isConnected);
        setEmail(j.googleEmail ?? j.me?.googleEmail ?? null);
        setCalendarId(j.googleCalendarId ?? null);
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function connect() {
    setLoading(true);
    setMsg(null);
    // This path should start your OAuth flow and redirect back to /settings/account on success
    window.location.href = "/api/google/oauth/start";
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <b>Google Calendar</b>
          <div className="small muted">
            {connected
              ? `Connected${email ? `: ${email}` : ""}${calendarId ? ` · ${calendarId}` : ""}`
              : connected === null
                ? "Checking…"
                : "Not connected"}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" onClick={connect} disabled={loading}>
            {loading ? "Opening Google…" : connected ? "Reconnect" : "Connect"}
          </button>
        </div>
      </div>
      {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
