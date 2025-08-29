// components/GoogleCalendarConnect.tsx
"use client";
import { useEffect, useState } from "react";

export default function GoogleCalendarConnect() {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        if (!r.ok) { setConnected(false); return; }
        const j = await r.json().catch(() => null);
        setConnected(Boolean(j?.googleEmail || j?.me?.googleEmail));
        setEmail(j?.googleEmail || j?.me?.googleEmail || null);
      } catch {
        setConnected(false);
      }
    })();
  }, []);

  function connect() {
    setLoading(true);
    setMsg(null);
    window.location.href = "/api/google/oauth/start";
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <b>Google Calendar</b>
          <div className="small muted">
            {connected ? `Connected${email ? `: ${email}` : ""}` : "Not connected"}
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
