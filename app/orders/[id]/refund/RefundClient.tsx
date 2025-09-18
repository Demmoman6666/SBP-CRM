// app/orders/[id]/refund/RefundClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type LineMeta = { id: string; maxQty: number };

export default function RefundClient({
  orderId,
  currency,
  lines,
}: {
  orderId: string;
  currency: string;
  lines: LineMeta[];
}) {
  const [amount, setAmount] = useState<string>("0.00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // capture the parent form
  useEffect(() => {
    // find the nearest form (this component is inside it)
    let el: HTMLElement | null = document.currentScript?.parentElement || null;
    // fallback: walk up
    let parent = (document.activeElement as HTMLElement) || null;
    while (parent && parent.tagName !== "FORM") parent = parent.parentElement as HTMLElement | null;
    formRef.current = parent as HTMLFormElement | null;
  }, []);

  const readQuantities = () => {
    const form = formRef.current || (document.querySelector("form[action*='/api/orders/'][method='POST']") as HTMLFormElement | null);
    if (!form) return [];
    const items: Array<{ crmLineId: string; quantity: number }> = [];
    for (const l of lines) {
      const input = form.querySelector<HTMLInputElement>(`input[name="qty_${l.id}"]`);
      const q = Number(input?.value || 0);
      if (Number.isFinite(q) && q > 0) {
        items.push({ crmLineId: l.id, quantity: Math.min(q, l.maxQty) });
      }
    }
    return items;
  };

  const doPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = readQuantities();
      if (!items.length) {
        setAmount("0.00");
        return;
      }
      const res = await fetch(`/api/orders/${orderId}/refund/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Preview failed");
      setAmount(String(json?.amount ?? "0.00"));
    } catch (e: any) {
      setError(e?.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  // re-run when inputs change (debounced)
  useEffect(() => {
    const form = formRef.current || (document.querySelector("form[action*='/api/orders/'][method='POST']") as HTMLFormElement | null);
    if (!form) return;
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-refund-qty]"));

    let t: any;
    const handler = () => {
      clearTimeout(t);
      t = setTimeout(doPreview, 250);
    };
    inputs.forEach((i) => i.addEventListener("input", handler));
    // run once initially
    doPreview();

    return () => {
      inputs.forEach((i) => i.removeEventListener("input", handler));
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, lines.map((l) => l.id).join(",")]);

  const formatted = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
    } catch {
      const n = Number(amount);
      return Number.isFinite(n) ? `£${n.toFixed(2)}` : "£0.00";
    }
  }, [amount, currency]);

  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div className="small muted">
        {loading ? "Calculating refund…" : error ? <span style={{ color: "var(--danger, #b91c1c)" }}>{error}</span> : "Refund preview from Shopify"}
      </div>
      <div style={{ fontWeight: 700 }}>
        Refund total: {formatted}
      </div>
    </div>
  );
}
