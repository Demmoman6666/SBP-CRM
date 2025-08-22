
// app/customers/page.tsx
import Link from 'next/link';

export default function CustomersPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Customers</h1>

      <div className="flex flex-wrap gap-3 items-center">
        <form action="/customers" method="GET" className="flex gap-2">
          <input
            name="q"
            placeholder="Search customers…"
            className="border rounded px-3 py-2"
          />
          <button type="submit" className="border rounded px-3 py-2">
            Search
          </button>
        </form>

        <Link href="/customers/new" className="border rounded px-3 py-2">
          Create Customer
        </Link>
      </div>
    </div>
  );
}
