// app/sales-hub/layout.tsx
export const dynamic = "force-dynamic";

export default function SalesHubLayout({
  children,
}: { children: React.ReactNode }) {
  // Segment layout, keeps things simple and guarantees a wrapper exists.
  return <>{children}</>;
}
