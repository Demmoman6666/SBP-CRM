// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

// ⬇️ Put your logo file at public/sbp-logo.png
import sbpLogo from "@/public/sbp-logo.png";

export const metadata: Metadata = {
  title: "Salon Brands Pro CRM",
  description: "Lightweight CRM for Salon Brands Pro.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            background: "#ffffff",
            borderBottom: "1px solid #eee",
          }}
        >
          <div
            className="container row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 16px",
              maxWidth: 1100,
              margin: "0 auto",
            }}
          >
            <Link href="/" className="row" style={{ alignItems: "center", gap: 10 }}>
              <Image
                src={sbpLogo}
                alt="Salon Brands Pro"
                className="brand-logo"
                priority
              />
            </Link>

            <nav className="row" style={{ alignItems: "center", gap: 12 }}>
              <Link href="/customers" style={{ textDecoration: "none", color: "#111" }}>
                Customers
              </Link>
              <Link
                href="/customers/new"
                className="primary"
                style={{
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "#FEB3E4",
                  color: "#111",
                  fontWeight: 600,
                }}
              >
                New Customer
              </Link>
            </nav>
          </div>
        </header>

        <main className="container" style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
          {children}
        </main>

        <footer style={{ borderTop: "1px solid #eee", padding: "16px 0" }}>
          <div className="container" style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}>
            <small>© Salon Brands Pro</small>
          </div>
        </footer>
      </body>
    </html>
  );
}
