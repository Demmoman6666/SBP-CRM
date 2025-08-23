// app/calls/new/page.tsx
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import React from "react";

export const dynamic = "force-dynamic";

export default async function NewCallPage() {
  const salesReps = await prisma.salesRep.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Server action to create the call log
  async function createCall(formData: FormData) {
    "use server";

    const isExisting = String(formData.get("isExistingCustomer") || "") === "yes";
    const salesRep = String(formData.get("salesRep") || "").trim();
    const summary = String(formData.get("summary") || "").trim();

    // Required
    if (!salesRep) throw new Error("Sales rep is required.");
    if (!summary) throw new Error("Summary is required.");

    let customerId: string | null = null;
    let leadName: string | null = null;

    if (isExisting) {
      customerId = String(formData.get("customerId") || "").trim() || null;
      if (!customerId) throw new Error("Please choose a customer from the list.");
    } else {
      leadName = String(formData.get("leadCustomerName") || "").trim() || null;
      if (!leadName) throw new Error("Please enter a customer/lead name.");
    }

    const callType = String(formData.get("callType") || "").trim() || null;
    const outcome = String(formData.get("outcome") || "").trim() || null;

    let followUpAt: Date | null = null;
    const followRaw = String(formData.get("followUpAt") || "");
    if (followRaw) {
      // input type=datetime-local returns 'YYYY-MM-DDTHH:mm'
      followUpAt = new Date(followRaw);
      if (isNaN(followUpAt.getTime())) followUpAt = null;
    }

    await prisma.callLog.create({
      data: {
        isExistingCustomer: isExisting,
        customerId,
        customerName: leadName,
        callType,
        outcome,
        summary,
        staff: salesRep,
        followUpRequired: !!followUpAt,
        followUpAt,
      },
    });

    redirect("/"); // send them back home (change if you prefer)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Log Call</h1>
      </section>

      <section className="card">
        <form action={createCall} className="grid" style={{ gap: 12 }}>
          <ClientCallForm salesReps={salesReps} />
          <div className="right" style={{ marginTop: 8 }}>
            <button className="primary" type="submit">Save Call</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/* -------------------------
   Client bits (picker UI)
-------------------------- */
function CustomerPreview({
  c,
}: {
  c: {
    id: string;
    salonName: string | null;
    customerName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    county: string | null;
    postCode: string | null;
    customerEmailAddress: string | null;
    customerNumber: string | null;
    customerTelephone: string | null;
  };
}) {
  const addr = [
    c.addressLine1,
    c.addressLine2,
    c.town,
    c.county,
    c.postCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="small" style={{ marginTop: 6, color: "var(--muted)" }}>
      <div><b>{c.salonName || "-"}</b> — {c.customerName || "-"}</div>
      {addr && <div>{addr}</div>}
      <div>
        {c.customerEmailAddress || "-"}{" "}
        {c.customerNumber ? `• ${c.customerNumber}` : ""}{" "}
        {c.customerTelephone ? `• ${c.customerTelephone}` : ""}
      </div>
    </div>
  );
}

function SuggestionsList({
  items,
  onPick,
}: {
  items: any[];
  onPick: (c: any) => void;
}) {
  if (!items.length) return null;
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 30,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "var(--shadow)",
        marginTop: 4,
        width: "100%",
        maxHeight: 220,
        overflowY: "auto",
      }}
    >
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            border: "0",
            background: "#fff",
            cursor: "pointer",
          }}
          className="suggestion"
        >
          <div style={{ fontWeight: 600 }}>
            {c.salonName || "-"} <span className="muted">— {c.customerName || "-"}</span>
          </div>
          <div className="small muted">
            {[c.addressLine1, c.town, c.postCode].filter(Boolean).join(", ")}
          </div>
        </button>
      ))}
    </div>
  );
}

function useDebouncedValue<T>(val: T, delay = 200) {
  const [v, setV] = React.useState(val);
  React.useEffect(() => {
    const t = setTimeout(() => setV(val), delay);
    return () => clearTimeout(t);
  }, [val, delay]);
  return v;
}

function CustomerField({
  isExisting,
  onSelected,
}: {
  isExisting: boolean;
  onSelected: (c: any | null) => void;
}) {
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<any[]>([]);
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<any | null>(null);
  const dq = useDebouncedValue(q, 250);

  React.useEffect(() => {
    if (!isExisting) {
      // switching to "No" free-text mode
      setPicked(null);
      onSelected(null);
      return;
    }
  }, [isExisting, onSelected]);

  React.useEffect(() => {
    if (!isExisting) return;
    if (picked) return; // hide list if already picked
    const run = async () => {
      const term = dq.trim();
      if (term.length < 2) {
        setList([]);
        setOpen(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/customers?search=${encodeURIComponent(term)}&take=10`,
          { cache: "no-store" }
        );
        const json = await res.json();
        setList(Array.isArray(json) ? json : []);
        setOpen(true);
      } catch {
        setList([]);
        setOpen(false);
      }
    };
    run();
  }, [dq, isExisting, picked]);

  const pick = (c: any) => {
    setPicked(c);
    setQ(`${c.salonName || ""} — ${c.customerName || ""}`.trim());
    setOpen(false);
    onSelected(c);
  };

  const clear = () => {
    setPicked(null);
    onSelected(null);
    setQ("");
    setOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <label>Customer {isExisting && <span className="muted">*</span>}</label>

      {isExisting ? (
        <>
          <input
            type="search"
            placeholder="Start typing to search…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
              onSelected(null);
            }}
            autoComplete="off"
          />
          {picked ? (
            <>
              {/* submit the chosen id */}
              <input type="hidden" name="customerId" value={picked.id} />
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <button type="button" className="btn" onClick={clear}>
                  Change
                </button>
              </div>
              <CustomerPreview c={picked} />
            </>
          ) : (
            open && (
              <SuggestionsList
                items={list}
                onPick={(c) => pick(c)}
              />
            )
          )}
        </>
      ) : (
        <>
          <input
            type="text"
            name="leadCustomerName"
            placeholder="Customer / company name"
            required
          />
        </>
      )}
    </div>
  );
}

function ClientCallForm({
  salesReps,
}: {
  salesReps: { id: string; name: string }[];
}) {
  const [isExisting, setIsExisting] = React.useState<boolean | null>(null);
  const [picked, setPicked] = React.useState<any | null>(null);

  return (
    <>
      {/* Hidden boolean for server action */}
      <input
        type="hidden"
        name="isExistingCustomer"
        value={isExisting === null ? "" : isExisting ? "yes" : "no"}
      />

      <div className="grid grid-2">
        <div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <label>Is this an existing customer? <span className="muted">*</span></label>
            <div className="row" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 6, alignItems: "center" }}>
                <input
                  type="radio"
                  name="isExistingToggle"
                  onChange={() => setIsExisting(true)}
                  required
                />
                Yes
              </label>
              <label className="row" style={{ gap: 6, alignItems: "center" }}>
                <input
                  type="radio"
                  name="isExistingToggle"
                  onChange={() => setIsExisting(false)}
                  required
                />
                No
              </label>
            </div>
            {isExisting === null && (
              <div className="small" style={{ color: "var(--muted)" }}>
                You must choose one.
              </div>
            )}
          </fieldset>
        </div>

        <div>
          <label>Sales Rep <span className="muted">*</span></label>
          <select name="salesRep" required defaultValue="">
            <option value="" disabled>
              — Select Sales Rep —
            </option>
            {salesReps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <CustomerField
        isExisting={!!isExisting}
        onSelected={(c) => setPicked(c)}
      />

      <div className="grid grid-2">
        <div>
          <label>Call Type</label>
          <select name="callType" defaultValue="">
            <option value="">— Select —</option>
            <option value="Inbound">Inbound</option>
            <option value="Outbound">Outbound</option>
            <option value="Follow-up">Follow-up</option>
            <option value="Support">Support</option>
            <option value="Sales">Sales</option>
          </select>
        </div>

        <div>
          <label>Follow-up (optional)</label>
          <input type="datetime-local" name="followUpAt" />
        </div>
      </div>

      <div>
        <label>Summary <span className="muted">*</span></label>
        <textarea name="summary" rows={4} placeholder="What was discussed?" required />
      </div>

      <div>
        <label>Outcome</label>
        <select name="outcome" defaultValue="">
          <option value="">— Select —</option>
          <option value="No answer">No answer</option>
          <option value="Left voicemail">Left voicemail</option>
          <option value="Spoke to contact">Spoke to contact</option>
          <option value="Appointment booked">Appointment booked</option>
          <option value="Closed">Closed</option>
        </select>
      </div>
    </>
  );
}
