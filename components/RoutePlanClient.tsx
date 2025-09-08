// components/RoutePlanClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };

type Customer = {
  id: string;
  salonName: string;
  customerName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  country: string | null;
  customerNumber: string | null;
  customerEmailAddress: string | null;
  salesRep: string | null;
};

const DAYS = [
  { val: "MONDAY", label: "Monday" },
  { val: "TUESDAY", label: "Tuesday" },
  { val: "WEDNESDAY", label: "Wednesday" },
  { val: "THURSDAY", label: "Thursday" },
  { val: "FRIDAY", label: "Friday" },
] as const;

const MAX_STOPS_PER_MAPS_ROUTE = 25; // origin + destination + up to 23 waypoints
const WAYPOINT_LIMIT = MAX_STOPS_PER_MAPS_ROUTE - 2;

export default function RoutePlanClient({ reps }: { reps: Rep[] }) {
  // Filters
  const [rep, setRep] = useState<string>("");
  const [week, setWeek] = useState<string>("");
  const [day, setDay] = useState<string>("");

  // Data
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);

  // Maps options
  const [startAtCurrent, setStartAtCurrent] = useState<boolean>(true);
  const [startAtFurthest, setStartAtFurthest] = useState<boolean>(false);
  const [startAtCustom, setStartAtCustom] = useState<boolean>(false);
  const [customStart, setCustomStart] = useState<string>("");
  const [finishAtCustom, setFinishAtCustom] = useState<boolean>(false);
  const [customEnd, setCustomEnd] = useState<string>("");

  // Opening behavior
  const [openSameTab, setOpenSameTab] = useState<boolean>(false); // helpful on iOS Safari
  const [extraLegUrls, setExtraLegUrls] = useState<string[]>([]); // show links if multiple legs

  // Geolocation status
  const [geoStatus, setGeoStatus] =
    useState<"prompt" | "granted" | "denied" | "unsupported">("prompt");
  const insecureContext =
    typeof window !== "undefined" &&
    window.location.protocol !== "https:" &&
    window.location.hostname !== "localhost";

  const acRef = useRef<AbortController | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Build API query
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (rep) p.set("reps", rep);
    if (week) p.set("week", week);
    if (day) p.set("day", day);
    p.set("onlyPlanned", "1");
    p.set("limit", "1000");
    return p.toString();
  }, [rep, week, day]);

  // Load data
  useEffect(() => {
    if (!rep || !week || !day) {
      setRows([]);
      return;
    }
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/route-planning?${qs}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        setRows(r.ok ? await r.json() : []);
      } catch (e: any) {
        if (e?.name !== "AbortError") setRows([]);
      } finally {
        if (acRef.current === ac) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [qs, rep, week, day]);

  // Probe geolocation permission
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("geolocation" in navigator)) {
      setGeoStatus("unsupported");
      return;
    }
    // @ts-ignore
    if (navigator.permissions?.query) {
      // @ts-ignore
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((p: any) => {
          setGeoStatus(p.state as any);
          p.onchange = () => setGeoStatus(p.state as any);
        })
        .catch(() => {});
    }
  }, []);

  // Nudge prompt when toggling "start at furthest"
  useEffect(() => {
    if (startAtFurthest && geoStatus === "prompt" && !insecureContext) {
      requestLocationOnce(); // fire prompt
    }
  }, [startAtFurthest, geoStatus, insecureContext]);

  // -------- Helpers --------
  function geocodeAddress(r: Customer): string {
    // Address-only for stable geocoding (no salonName to avoid POI mismatches)
    return [
      r.addressLine1,
      r.addressLine2 || "",
      r.town || "",
      r.county || "",
      r.postCode || "",
      r.country || "UK",
    ]
      .filter(Boolean)
      .join(", ");
  }

  function googleDirUrl({
    origin,
    destination,
    waypoints,
  }: {
    origin: string;
    destination: string;
    waypoints: string[];
  }): string {
    const u = new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api", "1");
    u.searchParams.set("travelmode", "driving");
    u.searchParams.set("origin", origin);
    u.searchParams.set("destination", destination);
    if (waypoints.length) {
      // DO NOT add "optimize:true" — unsupported in api=1; becomes a bogus waypoint
      u.searchParams.set("waypoints", waypoints.join("|"));
    }
    return u.toString();
  }

  function buildMapsUrls(
    stops: string[],
    opts: { origin?: string | null; customEnd?: string }
  ): string[] {
    const cleaned = stops.filter((s, i) => i === 0 || s !== stops[i - 1]);
    const hasCustomEnd =
      !!opts.customEnd && String(opts.customEnd).trim().length > 0;
    const customEnd = hasCustomEnd ? String(opts.customEnd).trim() : undefined;

    if (cleaned.length === 0 && customEnd) {
      const origin =
        opts.origin && opts.origin.trim() ? opts.origin.trim() : "Current Location";
      return [googleDirUrl({ origin, destination: customEnd, waypoints: [] })];
    }
    if (cleaned.length === 0) return [];

    let origin =
      opts.origin && opts.origin.trim() ? opts.origin.trim() : "Current Location";
    let remaining = cleaned.slice();

    // If origin equals the first stop address, skip it from remaining
    if (origin !== "Current Location" && origin === cleaned[0]) {
      remaining = cleaned.slice(1);
    }

    if (remaining.length === 0) {
      if (customEnd) {
        const single = cleaned[0];
        return [
          googleDirUrl({ origin, destination: single, waypoints: [] }),
          googleDirUrl({ origin: single, destination: customEnd, waypoints: [] }),
        ];
      }
      return [googleDirUrl({ origin, destination: cleaned[0], waypoints: [] })];
    }

    const urls: string[] = [];
    let legOrigin = origin;
    let i = 0;

    while (i < remaining.length) {
      const segment = remaining.slice(i, i + (WAYPOINT_LIMIT + 1));
      const isLastSegment = i + segment.length >= remaining.length;
      const destination = isLastSegment && customEnd ? customEnd : segment[segment.length - 1];
      const waypoints = isLastSegment && customEnd ? segment : segment.slice(0, -1);

      urls.push(googleDirUrl({ origin: legOrigin, destination, waypoints }));
      legOrigin = destination;
      i += segment.length;
    }

    return urls;
  }

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator))
        return reject(new Error("Geolocation not supported"));
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });
  }

  async function requestLocationOnce() {
    try {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => {
            setGeoStatus("granted");
            resolve();
          },
          () => {
            setGeoStatus("denied");
            resolve();
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
        );
      });
    } catch {
      setGeoStatus("denied");
    }
  }

  async function reorderByFurthestFromMe(addrs: string[]): Promise<string[]> {
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      if (!apiKey) return postcodeHeuristicFurthest(addrs);

      const destinations = addrs.map(encodeURIComponent).join("|");
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat},${lng}&destinations=${destinations}&mode=driving&key=${apiKey}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Distance Matrix request failed");
      const data = await res.json();

      const elements = data?.rows?.[0]?.elements;
      if (!Array.isArray(elements) || elements.length !== addrs.length)
        throw new Error("Bad Distance Matrix shape");

      const paired = addrs.map((addr, i) => ({
        addr,
        metric: Number(
          elements[i]?.duration?.value ?? elements[i]?.distance?.value ?? 0
        ),
      }));
      paired.sort((a, b) => b.metric - a.metric); // DESC
      return paired.map((p) => p.addr);
    } catch {
      return postcodeHeuristicFurthest(addrs);
    }
  }

  function postcodeHeuristicFurthest(addrs: string[]): string[] {
    const token = (s: string) =>
      (s.match(/[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}$/i) || [""])[0].toUpperCase();
    return [...addrs].sort((a, b) => token(b).localeCompare(token(a)));
  }

  // -------- Action (with popup-safe pre-open) --------
  async function openInGoogleMaps() {
    if (!rows.length) return;

    // Pre-open a tab synchronously to preserve the user gesture (prevents popup blocking after awaits)
    let pre: Window | null = null;
    if (!openSameTab) {
      pre = window.open("", "_blank"); // about:blank
    }

    // Build stop list (address-only)
    let stops = rows.map(geocodeAddress);

    // Reorder for furthest start if requested (async)
    if (startAtFurthest) {
      stops = await reorderByFurthestFromMe(stops);
    }

    // Decide origin string
    let origin: string | null = null;
    if (startAtCustom && customStart.trim()) origin = customStart.trim();
    else if (startAtCurrent) origin = "Current Location";
    else origin = stops[0];

    const urls = buildMapsUrls(stops, {
      origin,
      customEnd: finishAtCustom && customEnd.trim() ? customEnd.trim() : undefined,
    });

    if (!urls.length) {
      if (pre) try { pre.close(); } catch {}
      return;
    }

    // Navigate first leg
    const first = urls[0];

    if (openSameTab) {
      // Most reliable on iOS Safari
      window.location.href = first;
    } else if (pre && typeof pre.location !== "undefined") {
      // Use the pre-opened tab (works on mobile reliably)
      pre.location.href = first;
    } else {
      // Popup blocked fallback: use same tab
      window.location.href = first;
    }

    // Handle extra legs via UI (multiple popups often blocked on mobile)
    const rest = urls.slice(1);
    setExtraLegUrls(rest);
  }

  // -------- UI --------
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Route Plan</h2>

      {/* Filters */}
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 260 }}>
          <label>Sales Rep</label>
          <select
            value={rep}
            onChange={(e) => { setRep(e.target.value); setWeek(""); setDay(""); }}
          >
            <option value="">— Select a rep —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ minWidth: 160 }}>
          <label>Week</label>
          <select
            value={week}
            onChange={(e) => { setWeek(e.target.value); setDay(""); }}
            disabled={!rep}
          >
            <option value="">— Select week —</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={String(n)}>Week {n}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ minWidth: 180 }}>
          <label>Day</label>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            disabled={!rep || !week}
          >
            <option value="">— Select day —</option>
            {DAYS.map((d) => (
              <option key={d.val} value={d.val}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Maps options */}
      <div className="row" style={{ gap: 12, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={startAtCurrent} onChange={(e) => setStartAtCurrent(e.target.checked)} />
          Start at current location
        </label>

        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={startAtFurthest} onChange={(e) => setStartAtFurthest(e.target.checked)} disabled={!rows.length} />
          Start at furthest away
        </label>

        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={startAtCustom} onChange={(e) => setStartAtCustom(e.target.checked)} />
          Start at custom location
        </label>
        {startAtCustom && (
          <input
            type="text"
            placeholder="e.g. Home, CF43 4XX"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            style={{ minWidth: 260 }}
          />
        )}

        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={finishAtCustom} onChange={(e) => setFinishAtCustom(e.target.checked)} />
          Finish at custom location
        </label>
        {finishAtCustom && (
          <input
            type="text"
            placeholder="e.g. Warehouse, CF43 4XX"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            style={{ minWidth: 260 }}
          />
        )}

        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={openSameTab} onChange={(e) => setOpenSameTab(e.target.checked)} />
          Open in this tab (mobile-friendly)
        </label>

        <button className="btn" onClick={openInGoogleMaps} disabled={!rows.length}>
          Open in Google Maps
        </button>
      </div>

      {/* Location enable + status */}
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        {geoStatus !== "granted" && !startAtCustom && (
          <button className="btn" type="button" onClick={requestLocationOnce}>
            Enable location
          </button>
        )}
        <span className="small" style={{ color: geoStatus === "denied" ? "var(--danger,#b91c1c)" : "var(--muted)" }}>
          Location: {insecureContext ? "unavailable (use HTTPS or localhost)" : geoStatus}
        </span>
      </div>
      {insecureContext && (
        <div className="small muted" style={{ marginTop: 6 }}>
          Geolocation prompts require HTTPS (or localhost in dev). Open your Vercel URL or enable HTTPS.
        </div>
      )}

      {/* Results */}
      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Day’s Route</h3>
          <div className="small muted">
            {rep && week && day
              ? (loading ? "Loading…" : `${rows.length} salon${rows.length === 1 ? "" : "s"}`)
              : "Select rep, week, and day to view"}
          </div>
        </div>

        {!rep || !week || !day ? (
          <p className="small" style={{ marginTop: 12 }}>Awaiting selections…</p>
        ) : !rows.length ? (
          <p className="small" style={{ marginTop: 12 }}>
            {loading ? "Loading…" : "No matches found."}
          </p>
        ) : (
          <div className="table" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Salon</th>
                  <th>Contact</th>
                  <th>Town</th>
                  <th>Postcode</th>
                  <th>Sales Rep</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small" style={{ maxWidth: 260, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                      {r.salonName}
                      <div className="small" style={{ color: "var(--muted)" }}>
                        {r.addressLine1}
                        {r.addressLine2 ? `, ${r.addressLine2}` : ""}
                        {r.town ? `, ${r.town}` : ""}
                        {r.county ? `, ${r.county}` : ""}
                        {r.postCode ? `, ${r.postCode}` : ""}
                        {r.country ? `, ${r.country}` : ""}
                      </div>
                    </td>
                    <td className="small">{r.customerName || "—"}</td>
                    <td className="small">{r.town || "—"}</td>
                    <td className="small">{r.postCode || "—"}</td>
                    <td className="small">{r.salesRep || "—"}</td>
                    <td className="small right">
                      <Link href={`/customers/${r.id}`} className="btn small">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Extra legs list (user taps to open each) */}
      {extraLegUrls.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>More route legs</strong>
            <span className="small muted">{extraLegUrls.length} remaining</span>
          </div>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            {extraLegUrls.map((u, i) => (
              <a key={i} className="btn" href={u} target="_blank" rel="noopener noreferrer">
                Open leg {i + 2}
              </a>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Your browser may block multiple tabs. Tap each leg to continue the route.
          </div>
        </div>
      )}
    </section>
  );
}
