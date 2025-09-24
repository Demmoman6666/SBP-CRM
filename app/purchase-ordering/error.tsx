'use client';

export default function Error({
  error,
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-2">Purchase Ordering error</h2>
      <pre className="text-sm bg-gray-50 p-3 rounded">{error?.message || String(error)}</pre>
      <button onClick={reset} className="mt-3 border rounded px-3 py-1">Retry</button>
    </div>
  );
}
