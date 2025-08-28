// app/settings/global/competitor-brands/page.tsx
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getAll() {
  return prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibleInCallLog: true },
  });
}

export default async function CompetitorBrandVisibilityPage() {
  const items = await getAll();

  async function save(formData: FormData) {
    "use server";
    const ids = formData.getAll("ids").map(String);
    await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/settings/brand-visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "competitor", ids }),
      cache: "no-store",
    });
  }

  return (
    <div className="card grid" style={{ gap: 12 }}>
      <h2>Toggle Competitor Brands</h2>
      <form action={save} className="grid" style={{ gap: 8 }}>
        {items.map((b) => (
          <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="ids" value={b.id} defaultChecked={b.visibleInCallLog} />
            {b.name}
          </label>
        ))}
        {items.length === 0 && <div className="small muted">No competitor brands yet.</div>}
        <div className="right">
          <button className="primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
