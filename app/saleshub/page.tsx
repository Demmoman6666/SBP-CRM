// app/saleshub/page.tsx
import Link from "next/link";
import PipelineTile from "@/components/PipelineTile";

export const dynamic = "force-static";
export const revalidate = 1;

type Stage = "CUSTOMER" | "SAMPLING" | "APPOINTMENT_BOOKED" | "LEAD";

const STAGE_LABELS: Record<Stage, string> = {
  CUSTOMER: "Existing Customer",
  SAMPLING: "Sampling",
  APPOINTMENT_BOOKED: "Appointment booked",
  LEAD: "Lead",
};

export default function SalesHubPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const selectedStage = String(searchParams?.stage || "").toUpperCase() as Stage | "";

  function stageHref(stage?: Stage) {
    return stage ? `/saleshub?stage=${stage}` : "/saleshub";
  }

  const Chip = ({
    stage,
    children,
  }: {
    stage?: Stage;
    children: React.ReactNode;
  }) => {
    const isActive =
      (!!stage && selectedStage === stage) || (!stage && !selectedStage);
    return (
      <Link
        href={stageHref(stage)}
        className="badge"
        style={{
          textDecoration: "none",
          cursor: "pointer",
          padding: "4px 10px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: isActive ? "#111" : "transparent",
          color: isActive ? "#fff" : "inherit",
        }}
      >
        {children}
      </Link>
    );
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Sales Hub</h1>
        <p className="small">Everything for customer management and call logging.</p>
      </section>

      <section className="home-actions">
        <Link href="/customers/new" className="action-tile">
          <div className="action-title">New Customer</div>
          <div className="action-sub">Create a new customer profile</div>
        </Link>

        <Link href="/customers" className="action-tile">
          <div className="action-title">Customers</div>
          <div className="action-sub">Search &amp; update customers</div>
        </Link>

        <Link href="/calls/new" className="action-tile">
          <div className="action-title">Log Call</div>
          <div className="action-sub">Capture a call with a customer/lead</div>
        </Link>

        <Link href="/calls" className="action-tile">
          <div className="action-title">View Call Log</div>
          <div className="action-sub">Live calls with powerful filters</div>
        </Link>

        {/* Profit Calculator */}
        <Link href="/tools/profit-calculator" className="action-tile">
          <div className="action-title">Profit Calculator</div>
          <div className="action-sub">Model margins &amp; profit</div>
        </Link>
      </section>

      {/* Quick stage filters for the Pipeline */}
      <section className="card">
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="small muted">Stage</span>
          <Chip>{/* All */}All</Chip>
          <Chip stage="CUSTOMER">{STAGE_LABELS.CUSTOMER}</Chip>
          <Chip stage="SAMPLING">{STAGE_LABELS.SAMPLING}</Chip>
          <Chip stage="APPOINTMENT_BOOKED">{STAGE_LABELS.APPOINTMENT_BOOKED}</Chip>
          <Chip stage="LEAD">{STAGE_LABELS.LEAD}</Chip>
        </div>
      </section>

      {/* Pipeline tile (reads ?stage= from URL and calls /api/pipeline?stage=...) */}
      <PipelineTile />
    </div>
  );
}
