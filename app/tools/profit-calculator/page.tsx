// app/tools/profit-calculator/page.tsx
"use client";

import ProfitCalculator from "@/components/ProfitCalculator";
import Link from "next/link";

export default function ProfitCalculatorPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h1>Salon Profit Calculator</h1>
            <p className="small">Quickly model costs, margins, and profit.</p>
          </div>
          <Link href="/saleshub" className="small">← Back to Sales Hub</Link>
        </div>
      </section>

      <section className="card">
        {/* Your calculator lives inside this component */}
        <ProfitCalculator />
      </section>
    </div>
  );
}
