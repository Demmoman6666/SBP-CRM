export type DemandInputs = {
  avgDaily: number; // from processed orders
  dailyStdDev?: number; // optional
  leadTimeDays: number;
  reviewDays: number;   // your PO cadence, e.g. 7
  bufferDays: number;   // UI slider
  serviceLevelZ: number; // 1.28=90%, 1.64=95%, 2.05=98%
  horizonDays: number;  // how far forward you want coverage
  onHand: number;
  inOrderBook: number; // open sales
  due: number;         // on POs
  packSize?: number;
  moq?: number;
};

export function suggestQty(x: DemandInputs) {
  const L = x.leadTimeDays + x.bufferDays;
  const R = x.reviewDays;
  const SS = x.dailyStdDev
    ? x.serviceLevelZ * x.dailyStdDev * Math.sqrt(L + R)
    : 0.3 * x.avgDaily * (L + R); // fallback heuristic
  const ROP = x.avgDaily * (L + R) + SS;
  const target = ROP + x.avgDaily * x.horizonDays;
  const netPos = x.onHand - x.inOrderBook + x.due;
  let qty = Math.max(0, Math.ceil(target - netPos));
  if (x.packSize && qty % x.packSize) qty = Math.ceil(qty / x.packSize) * x.packSize;
  if (x.moq) qty = Math.max(qty, x.moq);
  return { qty, rop: ROP, safety: SS, target, netPos };
}
