// app/customers/[id]/edit/page.tsx
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import EditForm from "./EditForm";
import { revalidatePath } from "next/cache";

export default async function EditCustomerPage({
  params,
}: { params: { id: string } }) {
  const [customer, reps, brands] = await Promise.all([
    prisma.customer.findUnique({ where: { id: params.id } }),
    prisma.salesRep.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!customer) {
    return (
      <div className="card">
        <h2>Not found</h2>
        <p className="small">No customer with id {params.id}.</p>
        <Link className="primary" href="/customers">Back to customers</Link>
      </div>
    );
  }

  // ---- Server action: save only the Route Planning fields ----
  async function updateRoutePlan(formData: FormData) {
    "use server";

    const enabled = formData.get("routePlanEnabled") === "on";

    // Weeks 1..4
    const weeksRaw = formData.getAll("routeWeeks").map(v => Number(String(v)));
    const routeWeeks = Array.from(
      new Set(weeksRaw.filter(n => Number.isInteger(n) && n >= 1 && n <= 4))
    ).sort((a, b) => a - b);

    // Days (enum values)
    const validDays = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]);
    const daysRaw = formData.getAll("routeDays").map(v => String(v).toUpperCase());
    const routeDays = Array.from(new Set(daysRaw.filter(d => validDays.has(d))));

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        routePlanEnabled: enabled,
        routeWeeks,
        routeDays: routeDays as any, // RouteDay[]
      },
    });

    // Revalidate both edit + profile pages so UI reflects changes immediately
    revalidatePath(`/customers/${customer.id}`);
    revalidatePath(`/customers/${customer.id}/edit`);
  }

  const hasWeek = (n: number) =>
    Array.isArray(customer.routeWeeks) && customer.routeWeeks.includes(n);
  const hasDay = (d: string) =>
    Array.isArray(customer.routeDays) && (customer.routeDays as any[]).includes(d);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Edit Customer</h1>
        <p className="small">
          {customer.salonName} — {customer.customerName}
        </p>
      </section>

      <section className="card">
        <EditForm
          id={customer.id}
          initial={{
            salonName: customer.salonName || "",
            customerName: customer.customerName || "",
            addressLine1: customer.addressLine1 || "",
            addressLine2: customer.addressLine2 || "",
            town: customer.town || "",
            county: customer.county || "",
            postCode: customer.postCode || "",
            country: customer.country || "",
            customerTelephone: customer.customerTelephone || "",
            customerEmailAddress: customer.customerEmailAddress || "",
            brandsInterestedIn: customer.brandsInterestedIn || "",
            salesRep: customer.salesRep || "",
            numberOfChairs: customer.numberOfChairs ?? undefined,
            notes: customer.notes || "",
            openingHours: customer.openingHours || "",
          }}
          reps={reps}
          brands={brands}
        />
      </section>

      {/* ---------- Route Planning (added) ---------- */}
      <section className="card">
        <h3>Route Planning</h3>

        {/* CSS-only toggle to reveal Weeks/Days when enabled */}
        <style>{`
          #rp-enabled:checked ~ .rp-body { display: block; }
          .rp-body { display: ${customer.routePlanEnabled ? "block" : "none"}; }
          .chip {
            display: inline-flex; align-items: center; gap: 6px;
            border: 1px solid var(--border); border-radius: 999px;
            padding: 6px 10px; cursor: pointer; user-select: none;
          }
          .chips { display: flex; gap: 8px; flex-wrap: wrap; }
        `}</style>

        <form action={updateRoutePlan} style={{ marginTop: 8 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label htmlFor="rp-enabled" className="row" style={{ gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input
                id="rp-enabled"
                name="routePlanEnabled"
                type="checkbox"
                defaultChecked={!!customer.routePlanEnabled}
              />
              <span>Add To Route Plan</span>
            </label>
            <div className="form-hint">Include this salon in the 4-week Mon–Fri cycle.</div>
          </div>

          <div className="rp-body">
            <div className="grid" style={{ gap: 16, gridTemplateColumns: "1fr 2fr" }}>
              {/* Weeks */}
              <div className="field">
                <label>Weeks</label>
                <div className="chips">
                  {[1, 2, 3, 4].map((n) => (
                    <label key={n} className="chip">
                      <input
                        type="checkbox"
                        name="routeWeeks"
                        value={n}
                        defaultChecked={hasWeek(n)}
                      />
                      Week {n}
                    </label>
                  ))}
                </div>
                <div className="form-hint">Pick one or more of the 4 weeks.</div>
              </div>

              {/* Days */}
              <div className="field">
                <label>Days</label>
                <div className="chips">
                  {[
                    ["MONDAY", "Monday"],
                    ["TUESDAY", "Tuesday"],
                    ["WEDNESDAY", "Wednesday"],
                    ["THURSDAY", "Thursday"],
                    ["FRIDAY", "Friday"],
                  ].map(([val, label]) => (
                    <label key={val} className="chip">
                      <input
                        type="checkbox"
                        name="routeDays"
                        value={val}
                        defaultChecked={hasDay(val)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="form-hint">Pick one or more days (Mon–Fri).</div>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 16, alignItems: "center" }}>
            <button className="primary" type="submit">Save Route Plan</button>
            {customer.routePlanEnabled && (
              <span className="small muted">
                Current: weeks {Array.isArray(customer.routeWeeks) && customer.routeWeeks.length ? customer.routeWeeks.join(", ") : "—"};{" "}
                days {Array.isArray(customer.routeDays) && (customer.routeDays as any[]).length ? (customer.routeDays as any[]).join(", ") : "—"}
              </span>
            )}
          </div>
        </form>
      </section>
      {/* ---------- /Route Planning ---------- */}
    </div>
  );
}
