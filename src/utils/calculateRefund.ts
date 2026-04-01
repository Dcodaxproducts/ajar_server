// utils/refund.calculator.ts

import { differenceInCalendarDays } from "date-fns";
import { IRefundPolicy, ICancellationTier } from "../models/refundPolicy.model";

export interface RefundResult {
  refundAmount: number;
  deductedAmount: number;
  appliedTier: ICancellationTier | null;
  reason: string;
}

export function calculateRefund(
  totalPrice: number,
  checkInDate: Date,
  policy: IRefundPolicy,
  now: Date = new Date()  // injectable so you can unit test with a fixed date
): RefundResult {

  // policy-level kill switch
  if (!policy.allowRefund) {
    return noRefund(totalPrice, "Refunds are not allowed for this category/zone");
  }

  // can't refund a booking whose check-in already passed
  const daysRemaining = differenceInCalendarDays(checkInDate, now);
  if (daysRemaining < 0) {
    return noRefund(totalPrice, "Check-in date has already passed");
  }

  // sort tiers descending by daysBeforeCheckIn
  // e.g. [20, 7, 0] — match the highest threshold the user still qualifies for
  const sortedTiers = [...policy.tiers].sort(
    (a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn
  );

  const matchedTier = sortedTiers.find(
    (tier) => daysRemaining >= tier.daysBeforeCheckIn
  ) ?? null;

  // no tier matched at all — full refund (user cancelled very early, before any tier)
  if (!matchedTier) {
    return {
      refundAmount: totalPrice,
      deductedAmount: 0,
      appliedTier: null,
      reason: "Full refund — no cancellation tier applies",
    };
  }

  // 0% deduction tier — full refund
  if (matchedTier.percentage === 0) {
    return {
      refundAmount: totalPrice,
      deductedAmount: 0,
      appliedTier: matchedTier,
      reason: matchedTier.label ?? "Full refund within free cancellation window",
    };
  }

  // 100% deduction tier — no refund
  if (matchedTier.percentage >= 100) {
    return noRefund(
      totalPrice,
      matchedTier.label ?? "No refund — past cancellation cutoff"
    );
  }

  // partial deduction
  const deductedAmount = round2((totalPrice * matchedTier.percentage) / 100);
  const refundAmount = round2(totalPrice - deductedAmount);

  return {
    refundAmount,
    deductedAmount,
    appliedTier: matchedTier,
    reason:
      matchedTier.label ??
      `${matchedTier.percentage}% cancellation fee applied (${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} before check-in)`,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function noRefund(totalPrice: number, reason: string): RefundResult {
  return {
    refundAmount: 0,
    deductedAmount: totalPrice,
    appliedTier: null,
    reason,
  };
}

// avoids floating point mess e.g. 333.3333333 → 333.33
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}