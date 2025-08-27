// app/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { getUserByEmail } from "@/lib/auth";
import type { Permission } from "@prisma/client";

// Render on the server each request so permission changes apply immediately
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  // Read the login cookie your app sets (try a couple common names)
  const jar = cookies();
  const email =
    jar.get("sbp_email")?.value ??
    jar.get("userEmail")?.value ??
    "";

  const user = email ? await getUserByEmail(email) : null;

  const has = (p: Permission) => !!user?.features?.includes(p);

  // If no user, be permissive so local dev still works
  const canSalesHub = user ? has("VIEW_SALES_HUB") : true;
  const canReports  = user ? has("VIEW_REPORTS")   : true;
  const canSettings = user ? has("VIEW_SETTINGS")  : false;

  const nothingVisible = !canSalesHub && !canReports;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>Welcome to the Salon Brands Pro CRM</h1>
          <p className="small">Use the tiles below to get started.</p>
        </div>

        {canSettings && (
          <Link href="/settings" className="small" style={{ textDecoration: "underline" }}>
            Settings
          </Link>
        )}
      </section>

      {nothingVisible ? (
        <section className="card">
          <p className="small">
            You don’t have access to any modules on the Home screen. Ask an admin to grant you
            permissions for <b>Sales Hub</b> and/or <b>Reporting</b>.
          </p>
        </section>
      ) : (
        <section className="home-actions">
          {canSalesHub && (
            <Link href="/saleshub" className="action-tile">
              <div className="action-title">Sales Hub</div>
              <div className="action-sub">Customers &amp; Calls</div>
            </Link>
          )}

          {canReports && (
            <Link href="/reports" className="action-tile">
              <div className="action-title">Reporting</div>
              <div className="action-sub">Call &amp; customer reporting</div>
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
