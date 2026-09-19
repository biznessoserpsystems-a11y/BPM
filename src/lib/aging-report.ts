/**
 * Standard AP/AR aging methodology: oldest-charge-first (FIFO) settlement.
 * Given a list of dated charges (goods receipts owed to a supplier, or
 * insurance sales owed by a customer) and a total amount already settled
 * against them, this walks the charges oldest-first, applies the
 * settled total against them in order, and returns each charge's
 * still-outstanding portion bucketed by how long it's been outstanding.
 *
 * This is the same simplification most small-business aging reports use
 * when payments aren't matched to a specific invoice at the time they're
 * recorded (this app's Payments feature pays down a supplier's balance as
 * a whole, not a specific goods receipt) — it's an assumption, not a
 * guarantee of which literal invoice a given payment closed out, but it's
 * the standard, defensible one.
 */

export interface AgingCharge {
  date: Date;
  amount: number;
  reference: string;
}

export interface AgingBuckets {
  current: number; // 0-30 days
  days31to60: number;
  days61to90: number;
  over90: number;
}

export interface AgingResult extends AgingBuckets {
  totalOutstanding: number;
  oldestOutstandingDate: Date | null;
}

export function computeAging(charges: AgingCharge[], totalSettled: number, asOfDate: Date = new Date()): AgingResult {
  const sorted = [...charges].sort((a, b) => a.date.getTime() - b.date.getTime());

  const buckets: AgingBuckets = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
  let remainingSettled = totalSettled;
  let oldestOutstandingDate: Date | null = null;

  for (const charge of sorted) {
    const applied = Math.min(remainingSettled, charge.amount);
    remainingSettled -= applied;
    const outstanding = charge.amount - applied;
    if (outstanding <= 0.01) continue;

    if (!oldestOutstandingDate) oldestOutstandingDate = charge.date;

    const ageDays = Math.floor((asOfDate.getTime() - charge.date.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays <= 30) buckets.current += outstanding;
    else if (ageDays <= 60) buckets.days31to60 += outstanding;
    else if (ageDays <= 90) buckets.days61to90 += outstanding;
    else buckets.over90 += outstanding;
  }

  return {
    ...buckets,
    totalOutstanding: buckets.current + buckets.days31to60 + buckets.days61to90 + buckets.over90,
    oldestOutstandingDate,
  };
}
