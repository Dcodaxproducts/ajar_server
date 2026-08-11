import { differenceInHours } from "date-fns";
import {
  IRefundPolicy,
  ICancellationTier,
  IEarlyReturnTier,
} from "../models/refundPolicy.model";

export type RefundBasis = "checkIn" | "checkOut";

export interface RefundResult {
  refundAmount: number;
  deductedAmount: number;
  appliedTier: ICancellationTier | IEarlyReturnTier | null;
  reason: string;
  basis: RefundBasis;
}

/**
 * Cancellation before the rental starts — deduction is based on how long is
 * left until check-in.
 */
export function calculateRefund(
  totalPrice: number,
  checkInDate: Date,
  policy: IRefundPolicy,
  now: Date = new Date()
): RefundResult {
  if (!policy.allowRefund) {
    return noRefund(totalPrice, "Refunds are not allowed for this category/zone", "checkIn");
  }

  // can't refund a booking whose check-in already passed
  const hoursRemaining = differenceInHours(checkInDate, now);
  if (hoursRemaining < 0) {
    return noRefund(totalPrice, "Check-in date has already passed", "checkIn");
  }

  const sortedTiers = [...policy.tiers].sort(
    (a, b) => b.hoursBeforeCheckIn - a.hoursBeforeCheckIn
  );

  const matchedTier =
    sortedTiers.find((tier) => hoursRemaining >= tier.hoursBeforeCheckIn) ?? null;

  return applyTier({
    totalPrice,
    hoursRemaining,
    matchedTier,
    percentage: matchedTier?.percentage,
    label: matchedTier?.label,
    basis: "checkIn",
    boundaryLabel: "check-in",
  });
}

/**
 * Early return once the rental is already running — deduction is based on how
 * long is left until check-out. Falls back to a full refund when the zone has
 * no early-return tiers configured, mirroring calculateRefund.
 */
export function calculateEarlyReturnRefund(
  totalPrice: number,
  checkOutDate: Date,
  policy: IRefundPolicy,
  now: Date = new Date()
): RefundResult {
  if (!policy.allowRefund) {
    return noRefund(totalPrice, "Refunds are not allowed for this category/zone", "checkOut");
  }

  // rental has already run its full course — nothing left to refund
  const hoursRemaining = differenceInHours(checkOutDate, now);
  if (hoursRemaining < 0) {
    return noRefund(totalPrice, "Check-out date has already passed", "checkOut");
  }

  const sortedTiers = [...(policy.earlyReturnTiers ?? [])].sort(
    (a, b) => b.hoursBeforeCheckOut - a.hoursBeforeCheckOut
  );

  const matchedTier =
    sortedTiers.find((tier) => hoursRemaining >= tier.hoursBeforeCheckOut) ?? null;

  return applyTier({
    totalPrice,
    hoursRemaining,
    matchedTier,
    percentage: matchedTier?.percentage,
    label: matchedTier?.label,
    basis: "checkOut",
    boundaryLabel: "check-out",
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Shared tier maths so both bases behave identically once a tier is picked
function applyTier({
  totalPrice,
  hoursRemaining,
  matchedTier,
  percentage,
  label,
  basis,
  boundaryLabel,
}: {
  totalPrice: number;
  hoursRemaining: number;
  matchedTier: ICancellationTier | IEarlyReturnTier | null;
  percentage?: number;
  label?: string;
  basis: RefundBasis;
  boundaryLabel: string;
}): RefundResult {
  // no tier matched at all — full refund (cancelled before any tier applies)
  if (!matchedTier || percentage === undefined) {
    return {
      refundAmount: totalPrice,
      deductedAmount: 0,
      appliedTier: null,
      reason: "Full refund — no cancellation tier applies",
      basis,
    };
  }

  // 0% deduction tier — full refund
  if (percentage === 0) {
    return {
      refundAmount: totalPrice,
      deductedAmount: 0,
      appliedTier: matchedTier,
      reason: label ?? "Full refund within free cancellation window",
      basis,
    };
  }

  // 100% deduction tier — no refund
  if (percentage >= 100) {
    return noRefund(
      totalPrice,
      label ?? "No refund — past cancellation cutoff",
      basis,
      matchedTier
    );
  }

  const deductedAmount = round2((totalPrice * percentage) / 100);
  const refundAmount = round2(totalPrice - deductedAmount);

  return {
    refundAmount,
    deductedAmount,
    appliedTier: matchedTier,
    reason:
      label ??
      `${percentage}% cancellation fee applied (${hoursRemaining} hour${hoursRemaining !== 1 ? "s" : ""} before ${boundaryLabel})`,
    basis,
  };
}

function noRefund(
  totalPrice: number,
  reason: string,
  basis: RefundBasis,
  appliedTier: ICancellationTier | IEarlyReturnTier | null = null
): RefundResult {
  return {
    refundAmount: 0,
    deductedAmount: totalPrice,
    appliedTier,
    reason,
    basis,
  };
}

// avoids floating point mess e.g. 333.3333333 → 333.33
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
