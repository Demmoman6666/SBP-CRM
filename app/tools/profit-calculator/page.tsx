// app/tools/profit-calculator/page.tsx
import Link from "next/link";
import ProfitCalculator from "@/components/ProfitCalculator";

export const dynamic = "force-static"; // simple static shell
export const revalidate = 1;

export default function ProfitCalculatorPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Salon Retail Profit Calculator</h1>
            <p className="small">Estimate units, revenue &amp; profit for your retail promotion.</p>
          </div>
          <Link href="/saleshub" className="small" style={{ textDecoration: "underline" }}>
            &larr; Back to Sales Hub
          </Link>
        </div>
      </section>

      <section className="card">
        <ProfitCalculator />
      </section>
    </div>
  );
}
