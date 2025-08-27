// app/tools/profit-calculator/page.tsx
import Link from "next/link";
import ProfitCalculator from "@/components/ProfitCalculator";

export const dynamic = "force-static";
export const revalidate = 1;

export default function ProfitCalculatorPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h1>Salon Profit Calculator</h1>
          <Link href="/saleshub" className="small">← Back to Sales Hub</Link>
        </div>
        <p className="small">Quickly model costs, margins, and profit for retail products or services.</p>
      </section>

      <section className="card">
        <ProfitCalculator />
      </section>
    </div>
  );
}
