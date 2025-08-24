// components/DeleteCustomerButton.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteCustomerButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onDelete = async () => {
    if (loading) return;
    const ok = confirm(
      "Delete this customer and all related notes, visits, and call logs? This cannot be undone."
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.push("/customers");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to delete customer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" className="btn" onClick={onDelete} disabled={loading}>
      {loading ? "Deleting…" : "Delete"}
    </button>
  );
}
