'use client';

export default function GlobalError({
  error,
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  // This catches *any* client-side rendering error at the root.
  return (
    <html>
      <body style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 8 }}>
{error?.message || String(error)}
{error?.digest ? `\n\nDigest: ${error.digest}` : ''}
        </pre>
        <button onClick={reset} style={{ marginTop: 12, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
