// app/sales-hub/layout.tsx
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";   // ensure the route always exists at runtime
export const revalidate = 0;              // never cache the layout

export default function SalesHubLayout({ children }: { children: ReactNode }) {
  // minimal pass-through layout; MUST render {children}
  return <>{children}</>;
}
