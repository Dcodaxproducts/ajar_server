import assert from "node:assert/strict";
import test from "node:test";
import { RefundPolicy, type IRefundPolicy } from "../models/refundPolicy.model";
import { calculateRefund } from "../utils/calculateRefund";
import {
  normalizeCancellationTiers,
  resolveCancellationTierHours,
} from "../utils/refundPolicyTiers";

const policy = (tiers: IRefundPolicy["tiers"]): IRefundPolicy =>
  ({ allowRefund: true, tiers, earlyReturnTiers: [] } as unknown as IRefundPolicy);

test("legacy day tiers convert explicitly to hours without reinterpretation", () => {
  assert.deepEqual(
    normalizeCancellationTiers([{ daysBeforeCheckIn: 2, percentage: 25, label: "legacy" }]),
    [{ hoursBeforeCheckIn: 48, percentage: 25, label: "legacy" }]
  );
  assert.equal(resolveCancellationTierHours({ daysBeforeCheckIn: 3 }), 72);
});

test("conflicting, fractional, negative, and duplicate thresholds are rejected", () => {
  assert.throws(() => normalizeCancellationTiers([{ hoursBeforeCheckIn: 24, daysBeforeCheckIn: 2, percentage: 20 }]));
  assert.throws(() => normalizeCancellationTiers([{ hoursBeforeCheckIn: 1.5, percentage: 20 }]));
  assert.throws(() => normalizeCancellationTiers([{ hoursBeforeCheckIn: -1, percentage: 20 }]));
  assert.throws(() => normalizeCancellationTiers([
    { hoursBeforeCheckIn: 24, percentage: 20 },
    { daysBeforeCheckIn: 1, percentage: 30 },
  ]));
});

test("legacy persisted tiers serialize through the API with hour naming only", () => {
  const document = new RefundPolicy({
    zone: "507f1f77bcf86cd799439011",
    subCategory: "507f1f77bcf86cd799439012",
    allowRefund: true,
    tiers: [{ daysBeforeCheckIn: 2, percentage: 25 }],
  });
  const output = document.toJSON();
  assert.equal(output.tiers[0].hoursBeforeCheckIn, 48);
  assert.equal("daysBeforeCheckIn" in output.tiers[0], false);
});

test("exactly N hours qualifies while one millisecond below does not", () => {
  const now = new Date("2026-10-09T00:00:00.000Z");
  const tiers = [{ hoursBeforeCheckIn: 24, percentage: 50 }];
  assert.equal(calculateRefund(100, new Date("2026-10-10T00:00:00.000Z"), policy(tiers), now).refundAmount, 50);
  assert.equal(calculateRefund(100, new Date("2026-10-09T23:59:59.999Z"), policy(tiers), now).refundAmount, 100);
});

test("eligibility uses elapsed UTC duration and supports unmigrated legacy documents", () => {
  const now = new Date("2026-03-29T00:30:00.000Z");
  const legacyTier = { daysBeforeCheckIn: 1, percentage: 40 } as unknown as IRefundPolicy["tiers"][number];
  const result = calculateRefund(100, new Date("2026-03-30T00:30:00.000Z"), policy([legacyTier]), now);
  assert.equal(result.refundAmount, 60);
  assert.ok(result.appliedTier && "hoursBeforeCheckIn" in result.appliedTier);
  assert.equal(result.appliedTier.hoursBeforeCheckIn, 24);
});
