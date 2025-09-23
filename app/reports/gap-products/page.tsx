// app/reports/gap-products/page.tsx
import "server-only";
import GapProductsClient from "./ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  return <GapProductsClient />;
}
