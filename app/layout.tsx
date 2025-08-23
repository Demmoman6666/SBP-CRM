// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import SettingsMenu from "@/components/SettingsMenu";

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
          {/* 3-column grid: [spacer] [centered logo] [settings] */}
          <div
            className="container"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              padding: "12px 16px",
              maxWidth: 1100,
              margin: "0 auto",
            }}
          >
            <div /> {/* left spacer */}

            <Link
              href="/"
              style={{
                justifySelf: "center",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {/* Bigger, centered logo */}
              <img
                src="/sbp-logo.png"
                alt="Salon Brands Pro"
                className="brand-logo"
                style={{ height: 84, width: "auto" }}
              />
            </Link>

            <div style={{ justifySelf: "end" }}>
              <SettingsMenu />
            </div>
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
