// app/marketing/page.tsx
export const dynamic = "force-static";
export const revalidate = 1;

export default function MarketingPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Marketing</h1>
        <p className="small">Campaigns, assets and outreach tools will live here.</p>
      </section>

      <section className="home-actions">
        <div className="action-tile" style={{ cursor: "default" }}>
          <div className="action-title">Email Campaigns</div>
          <div className="action-sub">Plan &amp; track customer emails</div>
        </div>
        <div className="action-tile" style={{ cursor: "default" }}>
          <div className="action-title">Asset Library</div>
          <div className="action-sub">Logos, images &amp; PDFs</div>
        </div>
        <div className="action-tile" style={{ cursor: "default" }}>
          <div className="action-title">Promotions</div>
          <div className="action-sub">Seasonal offers &amp; codes</div>
        </div>
      </section>
    </div>
  );
}
