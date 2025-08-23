// app/calls/new/page.tsx
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import CustomerPicker from "@/components/CustomerPicker";

export default async function NewCallPage() {
  const reps = await prisma.salesRep.findMany({ orderBy: { name: "asc" } });

  async function saveCall(formData: FormData) {
    "use server";

    const isExisting = String(formData.get("isExistingCustomer") || "") === "yes";
    const customerId = String(formData.get("customerId") || "");
    const salesRep = String(formData.get("salesRep") || "").trim(); // required
    const callType = String(formData.get("callType") || "").trim();
    const summary = String(formData.get("summary") || "").trim();
    const outcome = String(formData.get("outcome") || "").trim();
    const followUpAtStr = String(formData.get("followUpAt") || "");
    const followUpAt = followUpAtStr ? new Date(followUpAtStr) : null;

    if (!salesRep) {
      throw new Error("Sales Rep is required.");
    }
    if (isExisting && !customerId) {
      throw new Error("Please choose a customer from the list.");
    }
    if (!summary) {
      throw new Error("Summary is required.");
    }

    await prisma.callLog.create({
      data: {
        isExistingCustomer: isExisting,
        customerId: isExisting ? customerId : null,
        // for non-existing path we’re no longer collecting contactName; skip
        callType: callType || null,
        summary,
        outcome: outcome || null,
        staff: salesRep,
        followUpRequired: followUpAt ? true : false,
        followUpAt: followUpAt,
      },
    });

    revalidatePath("/calls/new");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h2>Log Call</h2>
        <form action={saveCall} className="grid" style={{ gap: 12 }}>
          {/* Existing customer? */}
          <div className="grid grid-2">
            <fieldset>
              <legend className="small" style={{ marginBottom: 6 }}>
                Is this an existing customer? *
              </legend>
              <label className="row" style={{ alignItems: "center", gap: 6 }}>
                <input type="radio" name="isExistingCustomer" value="yes" required /> Yes
              </label>
              <label className="row" style={{ alignItems: "center", gap: 6 }}>
                <input type="radio" name="isExistingCustomer" value="no" required /> No
              </label>
              <div className="form-hint">You must choose one.</div>
            </fieldset>

            {/* Sales Rep — required */}
            <div>
              <label>Sales Rep *</label>
              <select name="salesRep" required defaultValue="">
                <option value="" disabled>
                  — Select Sales Rep —
                </option>
                {reps.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Existing-customer picker (always rendered; validated server-side). 
              Optional: you can hide/show with a little JS if you want. */}
          <CustomerPicker label="Customer *" name="customerId" required />

          {/* Contact Name removed */}

          <div className="grid grid-2">
            <div>
              <label>Call Type</label>
              <select name="callType" defaultValue="">
                <option value="">— Select —</option>
                <option>Order</option>
                <option>Complaint</option>
                <option>Enquiry</option>
                <option>Account</option>
              </select>
            </div>

            <div>
              <label>Follow-up (optional)</label>
              <input type="datetime-local" name="followUpAt" />
            </div>
          </div>

          <div>
            <label>Summary *</label>
            <textarea name="summary" rows={4} placeholder="What was discussed?" required />
          </div>

          <div>
            <label>Outcome</label>
            <select name="outcome" defaultValue="">
              <option value="">— Select —</option>
              <option>Resolved</option>
              <option>Pending</option>
              <option>Escalated</option>
              <option>No Action</option>
            </select>
          </div>

          <div className="right">
            <button className="primary" type="submit">Save Call</button>
          </div>
        </form>
      </section>
    </div>
  );
}
