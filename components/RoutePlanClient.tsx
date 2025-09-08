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
  const [rep, setRep] = useState<string>("");
  const [week, setWeek] = useState<string>("");
  const [day, setDay] = useState<string>("");

  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);

  // Google Maps options
  const [startAtCurrent, setStartAtCurrent] = useState<boolean>(true);
  const [startAtFurthest, setStartAtFurthest] = useState<boolean>(false);
  const [finishAtCustom, setFinishAtCustom] = useState<boolean>(false);
  const [customEnd, setCustomEnd] = useState<string>("");

  const acRef = useRef<AbortController | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (rep) p.set("reps", rep);
    if (week) p.set("week", week);
    if (day) p.set("day", day);
    p.set("onlyPlanned", "1");
    p.set("limit", "1000");
    return p.toString();
  }, [rep, week, day]);

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
        const r = await fetch(`/api/route-planning?${qs}`, { cache: "no-store", signal: ac.signal });
        setRows(r.ok ? await r.json() : []);
      } catch (e: any) {
        if (e?.name !== "AbortError") setRows([]);
      } finally {
        if (acRef.current === ac) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [qs, rep, week, day]);

  // Address-only for stable geocoding (no salonName to avoid POI mismatches)
  function geocodeAddress(r: Customer): string {
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

  function buildMapsUrls(stops: string[], opts: { startAtCurrent: boolean; customEnd?: string }): string[] {
    const cleaned = stops.filter((s, i) => i === 0 || s !== stops[i - 1]);
    const hasCustomEnd = !!opts.customEnd && String(opts.customEnd).trim().length > 0;
    const customEnd = hasCustomEnd ? String(opts.customEnd).trim() : undefined;

    // If nothing to visit but a custom end exists, route directly there
    if (cleaned.length === 0 && customEnd) {
      const origin = opts.startAtCurrent ? "Current Location" : customEnd; // fallback
      return [googleDirUrl({ origin, destination: customEnd, waypoints: [] })];
    }
    if (cleaned.length === 0) return [];

    // Decide origin & remaining stops
    let origin: string;
    let remaining: string[];

    if (opts.startAtCurrent) {
      origin = "Current Location";
      remaining = cleaned.slice(); // all stops are waypoints + possibly destination
    } else {
      origin = cleaned[0];
      remaining = cleaned.slice(1);
    }

    const urls: string[] = [];
    let legOrigin = origin;
    let i = 0;

    if (!remaining.length) {
      // One stop + optional custom end
      if (customEnd) {
        // leg 1: origin -> single stop; leg 2: stop -> custom end
        const single = cleaned[0];
        urls.push(googleDirUrl({ origin, destination: single, waypoints: [] }));
        urls.push(googleDirUrl({ origin: single, destination: customEnd, waypoints: [] }));
        return urls;
      } else {
        return [googleDirUrl({ origin, destination: cleaned[0], waypoints: [] })];
      }
    }

    while (i < remaining.length) {
      // Build segments of up to WAYPOINT_LIMIT waypoints + 1 destination
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

  // ---- "Start at furthest away" helpers ----
  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) return reject(new Error("Geolocation not supported"));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000,
      });
    });
  }

  async function reorderByFurthestFromMe(addrs: string[]): Promise<string[]> {
    // Needs both location and API key for accurate distances.
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      if (!apiKey) {
        // No API key — fallback: simple heuristic by postcode (very rough).
        // Sort by reversed postcode string so farther-looking postcodes drift up.
        // If you set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, we’ll use Distance Matrix instead.
        return [...addrs].sort((a, b) => {
          const pa = (a.match(/[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}$/i) || [""])[0].toUpperCase();
          const pb = (b.match(/[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}$/i) || [""])[0].toUpperCase();
          return pb.localeCompare(pa);
        });
      }

      // Google Distance Matrix (simple, one-to-many)
      const destinations = addrs.map(encodeURIComponent).join("|");
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat},${lng}&destinations=${destinations}&mode=driving&key=${apiKey}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Distance Matrix request failed");
      const data = await res.json();

      const elements = data?.rows?.[0]?.elements;
      if (!Array.isArray(elements) || elements.length !== addrs.length) throw new Error("Bad Distance Matrix shape");

      // Pair each address with distance in metres (fallback to 0)
      const paired = addrs.map((addr, i) => ({
        addr,
        dist: Number(elements[i]?.distance?.value ?? 0),
      }));

      // Sort DESC by distance so the first is the furthest
      paired.sort((a, b) => b.dist - a.dist);

      return paired.map(p => p.addr);
    } catch {
      // Location blocked or network error: keep original order
      return addrs;
    }
  }

  // Open Maps with current options
  async function openInGoogleMaps() {
    if (!rows.length) return;

    // Build the base stop list (address-only)
    let stops = rows.map(geocodeAddress);

    // If "start at furthest", reorder stops so the first one is the furthest
    if (startAtFurthest) {
      stops = await reorderByFurthestFromMe(stops);
    }

    const urls = buildMapsUrls(stops, {
      startAtCurrent,
      customEnd: finishAtCustom && customEnd.trim() ? customEnd.trim() : undefined,
    });
    if (!urls.length) return;

    if (urls.length > 1) {
      const proceed =
        typeof window !== "undefined"
          ? window.confirm(`Your route needs ${urls.length} Google Maps tabs due to the 25-stop limit. Open them now?`)
          : true;
      if (!proceed) return;
    }

    for (const url of urls) {
      window.open(url, "_blank");
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Filters</h2>

      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Sales Rep */}
        <div className="field" style={{ minWidth: 260 }}>
          <label>Sales Rep</label>
          <select
            value={rep}
            onChange={(e) => {
              setRep(e.target.value);
              setWeek("");
              setDay("");
            }}
          >
            <option value="">— Select a rep —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {/* Week */}
        <div className="field" style={{ minWidth: 160 }}>
          <label>Week</label>
          <select
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setDay("");
            }}
            disabled={!rep}
          >
            <option value="">— Select week —</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={String(n)}>
                Week {n}
              </option>
            ))}
          </select>
        </div>

        {/* Day */}
        <div className="field" style={{ minWidth: 180 }}>
          <label>Day</label>
          <select value={day} onChange={(e) => setDay(e.target.value)} disabled={!rep || !week}>
            <option value="">— Select day —</option>
            {DAYS.map((d) => (
              <option key={d.val} value={d.val}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Google Maps options */}
      <div className="row" style={{ gap: 12, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={startAtCurrent}
            onChange={(e) => setStartAtCurrent(e.target.checked)}
          />
          Start at current location
        </label>

        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={startAtFurthest}
            onChange={(e) => setStartAtFurthest(e.target.checked)}
            disabled={!rows.length}
          />
          Start at furthest away
        </label>

        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={finishAtCustom}
            onChange={(e) => setFinishAtCustom(e.target.checked)}
          />
          Finish at custom location
        </label>

        {finishAtCustom && (
          <input
            type="text"
            placeholder="e.g. Hotel, Depot, CF43 4XX"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            style={{ minWidth: 260 }}
          />
        )}

        <button className="btn" onClick={openInGoogleMaps} disabled={!rows.length}>
          Open in Google Maps
        </button>
      </div>

      {startAtFurthest && !apiKey && (
        <div className="small muted" style={{ marginTop: 6 }}>
          Tip: Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> for accurate “furthest away” ordering
          (uses Google Distance Matrix). Without it, a rough postcode heuristic is used.
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Day’s Route</h3>
          <div className="small muted">
            {rep && week && day ? (loading ? "Loading…" : `${rows.length} salon${rows.length === 1 ? "" : "s"}`) : "Select rep, week, and day to view"}
          </div>
        </div>

        {!rep || !week || !day ? (
          <p className="small" style={{ marginTop: 12 }}>Awaiting selections…</p>
        ) : !rows.length ? (
          <p className="small" style={{ marginTop: 12 }}>{loading ? "Loading…" : "No matches found."}</p>
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
                    <td
                      className="small"
                      style={{ maxWidth: 260, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
                    >
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
                      <Link href={`/customers/${r.id}`} className="btn small">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
