// lib/pipeline.ts
// Maps call outcomes to the minimum guaranteed pipeline stage.
// Stage only ever moves FORWARD - never backward.

export type StageValue = "LEAD" | "ENGAGED" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

const STAGE_ORDER: StageValue[] = ["LEAD", "ENGAGED", "APPOINTMENT_BOOKED", "SAMPLING", "CUSTOMER"];

function stageRank(stage: StageValue): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? 0 : i;
}

// Outcome -> minimum stage it guarantees
export const OUTCOME_STAGE_MAP: Record<string, StageValue> = {
  "Not Available": "LEAD",
  "Left Details / Business Card": "LEAD",
  "No Interest": "LEAD",
  "Interested - Follow-up Booked": "ENGAGED",
  "Interested - Callback Requested": "ENGAGED",
  "No Sale": "ENGAGED",
  "Sample Requested": "SAMPLING",
  "Sample Reviewed - Positive": "SAMPLING",
  "Sample Reviewed - Negative": "SAMPLING",
  "Order Placed": "CUSTOMER",
  // Legacy outcomes (kept for backward compatibility with existing data)
  "Sale": "CUSTOMER",
  "Appointment booked": "ENGAGED",
  "Demo Booked": "ENGAGED",
};

export const NEXT_STEP_OPTIONS = [
  "Book Follow-up Call",
  "Book Sample Review",
  "Send Samples",
  "Send Payment Link / Close Sale",
  "No Further Action",
  "Escalate to Manager",
] as const;

export const CALL_TYPE_OPTIONS = [
  "Cold Call",
  "1st Booked Call",
  "Booked Call",
  "Sample Review",
  "Demo",
  "Account Management",
] as const;

export const OUTCOME_OPTIONS = [
  "Not Available",
  "Left Details / Business Card",
  "No Interest",
  "Interested - Follow-up Booked",
  "Interested - Callback Requested",
  "Sample Requested",
  "Sample Reviewed - Positive",
  "Sample Reviewed - Negative",
  "Order Placed",
  "No Sale",
] as const;

/**
 * Given a customer's current stage and a call outcome, returns the new stage.
 * Only ever moves forward - never downgrades.
 */
export function resolveStageAfterOutcome(
  currentStage: StageValue | null | undefined,
  outcome: string | null | undefined
): StageValue | null {
  if (!outcome) return null;
  const targetStage = OUTCOME_STAGE_MAP[outcome];
  if (!targetStage) return null;

  const current = currentStage || "LEAD";
  if (stageRank(targetStage) > stageRank(current)) {
    return targetStage;
  }
  return null; // no change needed
}

/**
 * Given an order total, returns the stage it guarantees (or null if no stage change applies).
 */
export function resolveStageAfterOrder(
  currentStage: StageValue | null | undefined,
  orderTotal: number
): StageValue | null {
  const current = currentStage || "LEAD";
  const targetStage: StageValue = orderTotal > 0 ? "CUSTOMER" : "SAMPLING";
  if (stageRank(targetStage) > stageRank(current)) {
    return targetStage;
  }
  return null;
}
