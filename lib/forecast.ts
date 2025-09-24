export type DemandInputs = {
  avgDaily: number;
  dailyStdDev?: number;
  leadTimeDays: number;
  reviewDays: number;
  bufferDays: number;
  serviceZ: number;
  horizonDays: number;
  onHand: number;
  inOrderBook: number;
  due: number;
  packSize?: number;
  moq?: number;
};

export function suggestQty(x: DemandInputs) {
  const L = x.leadTimeDays + x.bufferDays;
  const R = x.reviewDays;
  const SS = x.dailyStdDev
    ? x.serviceZ * x.dailyStdDev * Math.sqrt(L + R)
    : 0.3 * x.avgDaily * (L + R);
  const ROP = x.avgDaily * (L + R) + SS;
  const target = ROP + x.avgDaily * x.horizonDays;
  const netPos = x.onHand - x.inOrderBook + x.due;
  let qty = Math.max(0, Math.ceil(target - netPos));
  if (x.packSize && qty % x.packSize) qty = Math.ceil(qty / x.packSize) * x.packSize;
  if (x.moq) qty = Math.max(qty, x.moq);
  return { qty, rop: ROP, safety: SS, target, netPos };
}
