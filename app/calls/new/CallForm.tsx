"use client";

import { useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };
export default function CallForm({
  reps,
  createCall,
}: {
  reps: Rep[];
  createCall: (fd: FormData) => Promise<void>;
}) {
  const [existing, setExisting] = useState<"" | "yes" | "no">("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; label: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");

  const labelToId = useMemo(
    () => new Map(suggestions.map((s) => [s.label, s.id])),
    [suggestions]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const run = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        setSelectedId("");
        return;
      }
      const r = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
      });
      if (!r.ok) return;
      const json = await r.json();
      setSuggestions(json);
      const maybeId = json.find((x: any) => x.label === query)?.id ?? "";
      setSelectedId(maybeId);
    };
    run();
    return () => ctrl.abort();
  }, [query]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2>Log Call</h2>

        <form action={createCall} className="grid" style={{ gap: 12 }}>
          <div className="grid grid-2">
            <div>
              <label>Is this an existing customer? *</label>
              <div className="row" style={{ gap: 16 }}>
                <label>
                  <input
                    type="radio"
                    name="existing"
                    value="yes"
                    required
                    onChange={() => setExisting("yes")}
                  />{" "}
                  Yes
                </label>
                <label>
                  <input
                    type="radio"
                    name="existing"
                    value="no"
                    required
                    onChange={() => setExisting("no")}
                  />{" "}
                  No
                </label>
              </div>
            </div>

            <div>
              <label>Sales Rep (optional)</label>
              <select name="staff">
                <option value="">— Select Sales Rep —</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {existing === "yes" && (
            <div className="grid" style={{ gap: 12 }}>
              <div>
                <label>Customer *</label>
                <input
                  name="customerLabel"
                  list="customer-options"
                  placeholder="Type salon, contact or postcode…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                  onBlur={(e) => {
                    const id = labelToId.get(e.target.value) ?? "";
                    setSelectedId(id);
                  }}
                  required
                />
                <datalist id="customer-options">
                  {suggestions.map((s) => (
                    <option key={s.id} value={s.label} />
                  ))}
                </datalist>
                <input type="hidden" name="customerId" value={selectedId} />
                <p className="form-hint">Pick a suggestion so we capture the correct account.</p>
              </div>

              <div className="grid grid-2">
                <div>
                  <label>Contact Name</label>
                  <input name="contactName" placeholder="Who called?" />
                </div>
                <div>
                  <label>Call Type</label>
                  <select name="callType" defaultValue="">
                    <option value="">— Select —</option>
                    <option>Order</option>
                    <option>Product question</option>
                    <option>Education</option>
                    <option>Complaint</option>
                    <option>Account update</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label>Summary *</label>
                <textarea name="summary" rows={4} required placeholder="What was discussed?" />
              </div>

              <div className="grid grid-2">
                <div>
                  <label>Outcome</label>
                  <select name="outcome" defaultValue="">
                    <option value="">— Select —</option>
                    <option>Resolved</option>
                    <option>Pending</option>
                    <option>Follow-up required</option>
                  </select>
                </div>
                <div>
                  <label>Follow-up (optional)</label>
                  <input type="datetime-local" name="followUpAt" />
                </div>
              </div>
            </div>
          )}

          {existing === "no" && (
            <div className="grid" style={{ gap: 12 }}>
              <div className="grid grid-2">
                <div>
                  <label>Salon Name *</label>
                  <input name="new_salonName" required />
                </div>
                <div>
                  <label>Contact Name *</label>
                  <input name="new_contactName" required />
                </div>
              </div>

              <div className="grid grid-2">
                <div>
                  <label>Phone *</label>
                  <input name="new_contactPhone" required />
                </div>
                <div>
                  <label>Email</label>
                  <input type="email" name="new_contactEmail" />
                </div>
              </div>

              <div className="grid grid-2">
                <div>
                  <label>Call Type</label>
                  <select name="callType" defaultValue="">
                    <option value="">— Select —</option>
                    <option>New enquiry</option>
                    <option>Education</option>
                    <option>Sales</option>
                    <option>Support</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label>Follow-up (optional)</label>
                  <input type="datetime-local" name="followUpAt" />
                </div>
              </div>

              <div>
                <label>Summary *</label>
                <textarea name="summary" rows={4} required placeholder="What was discussed?" />
              </div>

              <div>
                <label>Outcome</label>
                <select name="outcome" defaultValue="">
                  <option value="">— Select —</option>
                  <option>Send info</option>
                  <option>Arrange visit</option>
                  <option>Not interested</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
          )}

          <div className="right">
            <button className="primary" type="submit" disabled={existing === ""}>
              Save Call
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
