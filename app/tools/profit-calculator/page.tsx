// app/tools/profit-calculator/page.tsx
import Link from "next/link";
import ProfitCalculator from "@/components/ProfitCalculator";

export const dynamic = "force-static"; // simple static shell
export const revalidate = 1;

export default function ProfitCalculatorPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h1>Salon Retail Profit Calculator</h1>
          <Link href="/saleshub" className="small">
            ← Back to Sales Hub
          </Link>
        </div>
        <p className="small">Estimate units, revenue & profit for your retail promotion.</p>
      </section>

      {/* Calculator (renders its own cards/layout) */}
      <ProfitCalculator />
    </div>
  );
}
