// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import SettingsMenu from "@/components/SettingsMenu";
import BackButton from "@/components/BackButton";

export const metadata: Metadata = {
  title: "Salon Brands Pro CRM",
  description: "Lightweight CRM for Salon Brands Pro.",
  // PWA / homescreen
  manifest: "/site.webmanifest",
  themeColor: "#ffffff",
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SBP CRM",
  },
  icons: {
    // Favicon & PWA icons
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    // iOS home screen
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Extra links/meta that aren't covered nicely by Metadata */}
      <head>
        {/* Safari pinned tab (monochrome mask icon) */}
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#f7a8d8" />
        {/* Ensure manifest is fetched even if Metadata changes are cached */}
        <link rel="manifest" href="/site.webmanifest" />
        {/* iOS hints (duplicates are fine; Metadata also sets these) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="SBP CRM" />
        <meta name="theme-color" content="#ffffff" />
      </head>

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
          {/* 3-column grid: [left/back] [centered logo] [settings] */}
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
            {/* Left: Back button (falls back to /customers if no history) */}
            <div style={{ justifySelf: "start" }}>
              <BackButton className="btn" label="Back" fallback="/customers" />
            </div>

            {/* Center: Logo */}
            <Link
              href="/"
              style={{
                justifySelf: "center",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <img
                src="/sbp-logo.png"
                alt="Salon Brands Pro"
                className="brand-logo"
                style={{ height: 84, width: "auto" }}
              />
            </Link>

            {/* Right: Settings */}
            <div style={{ justifySelf: "end" }}>
              <SettingsMenu />
            </div>
          </div>
        </header>

        <main
          className="container"
          style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}
        >
          {children}
        </main>

        <footer style={{ borderTop: "1px solid #eee", padding: "16px 0" }}>
          <div
            className="container"
            style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}
          >
            <small>© Salon Brands Pro</small>
          </div>
        </footer>
      </body>
    </html>
  );
}
