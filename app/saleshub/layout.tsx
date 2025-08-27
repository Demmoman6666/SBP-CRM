// app/saleshub/layout.tsx
export const dynamic = "force-static";
export const revalidate = 1;

export default function SaleshubLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
