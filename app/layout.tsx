// app/layout.tsx
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "SBP CRM",
  description: "Salon Brands Pro — simple CRM",
  themeColor: "#FEB3E4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <Link href="/" className="brand" aria-label="Salon Brands Pro Home">
              {/* Put your logo at /public/sbp-logo.png */}
              <Image
                src="/sbp-logo.png"
                alt="Salon Brands Pro"
                width={220}
                height={48}
                priority
              />
            </Link>

            <nav className="nav">
              <Link href="/customers">Customers</Link>
              <Link className="btn btn-sm primary" href="/customers/new">
                New Customer
              </Link>
            </nav>
          </div>
        </header>

        <main className="container">{children}</main>

        <footer className="footer">
          <div className="container">© Salon Brands Pro</div>
        </footer>
      </body>
    </html>
  );
}
