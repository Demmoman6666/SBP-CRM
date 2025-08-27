// lib/permissions.ts
export const FEATURES = {
  salesHub: "salesHub",
  reports: "reports",
  "reports.calls": "reports.calls",
  "reports.gap": "reports.gap",
  "reports.dropoff": "reports.dropoff",
  "tools.profitCalculator": "tools.profitCalculator",
} as const;

export type FeatureKey = keyof typeof FEATURES | string;

/** default-allow: if a key isn't specified, it's considered allowed */
export function canFeature(user: any, key: string) {
  const map = (user?.features ?? {}) as Record<string, boolean>;
  return map[key] ?? true;
}
