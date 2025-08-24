"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteCustomerButton({
  id,
  name,
}: {
  id: string;
  name?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (loading) return;
    const ok = confirm(
      `Delete “${name || "this customer"}”? This cannot be undone.`
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Failed to delete");
      }
      router.push("/customers");
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to delete");
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={loading}
      title="Delete customer"
      style={{
        background: "#fff",
        color: "#b91c1c",
        border: "1px solid #fca5a5",
        borderRadius: 8,
        padding: "8px 12px",
      }}
    >
      {loading ? "Deleting…" : "Delete"}
    </button>
  );
}
