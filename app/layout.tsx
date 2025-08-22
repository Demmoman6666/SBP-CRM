import "./globals.css";
import Link from "next/link";

export const metadata = { title: "SBP CRM", description: "Simple CRM for salon reps" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div className="row" style={{ gap: 12 }}>
              <Link href="/"><b>SBP CRM</b></Link>
              <span className="badge">beta</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link className="ghost" href="/customers/new">Create Customer</Link>
              <Link className="ghost" href="/customers/search">Search</Link>
              <form action="/api/logout" method="post"><button className="ghost" type="submit">Logout</button></form>
            </div>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}

