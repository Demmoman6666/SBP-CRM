// app/orders/new/page.tsx  (SERVER component)
import { Suspense } from "react";
import ClientNewOrder from "./ClientNewOrder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Create Order</h1>
      </section>

      <Suspense fallback={<div className="card">Loading order builder…</div>}>
        <ClientNewOrder />
      </Suspense>
    </div>
  );
}
