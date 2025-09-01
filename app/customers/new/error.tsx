// app/customers/new/error.tsx
"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <div className="card">
      <h3>Something went wrong</h3>
      <p className="small">{error.message}</p>
      <button className="chip" onClick={() => reset()}>Try again</button>
    </div>
  );
}
