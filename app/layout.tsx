// app/layout.tsx
import "./globals.css";

export const metadata = { title: "SBP CRM" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="navbar">
          <div className="container row" style={{ justifyContent: "space-between" }}>
            <a href="/" className="brand">SBP CRM</a>
            <div className="row" style={{ gap: 12 }}>
              <a href="/customers" className="link">Customers</a>
              <a href="/customers/new" className="button">New Customer</a>
            </div>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
