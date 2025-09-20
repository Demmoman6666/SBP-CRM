"use client";

import { useState } from "react";

type Line = {
  variant_id: number;
  quantity: number;
  price?: number; // ex VAT unit price if you override
  title?: string;
};

type Props = {
  customerId: string;
  enabled: boolean;            // whether customer has terms
  getCartLines: () => Line[];  // supply current cart lines from your page state
};

export default function PayOnAccountButton({ customerId, enabled, getCartLines }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!enabled || busy) return;
    const lines = getCartLines();
    if (!Array.isArray(lines) || lines.length === 0) {
      alert("Your cart is empty.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/shopify/orders/on-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ customerId, lines }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Failed to create order on account");
      }
      if (j.adminUrl) {
        window.open(j.adminUrl, "_blank");
      }
      // you can also clear the cart here if you like
      alert(`Order created ${j.orderNumber || ""}`.trim());
    } catch (e: any) {
      alert(e?.message || "Something went wrong creating the order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="btn"
      type="button"
      onClick={handleClick}
      disabled={!enabled || busy}
      aria-disabled={!enabled || busy}
      title={!enabled ? "Customer has no account terms" : "Create order (unpaid, on account)"}
      style={{
        opacity: !enabled || busy ? 0.6 : 1,
        cursor: !enabled || busy ? "not-allowed" : "pointer",
      }}
    >
      {busy ? "Creating…" : "Pay on account"}
    </button>
  );
}
