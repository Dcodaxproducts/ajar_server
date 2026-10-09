import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDepositRefundIdempotencyKey,
  canReadDamageDispute,
  calculateDisputeDeadline,
  isDisputeWindowOpen,
  isValidDisputeWindowDays,
  isBookingParty,
  validateDamageDisputeInput,
} from "../services/damageDispute.service";

test("dispute interval is open before, but not at, the exact UTC deadline", () => {
  const returnedAt = new Date("2026-10-01T12:00:00.000Z");
  const deadline = calculateDisputeDeadline(returnedAt, 7);
  assert.equal(deadline.toISOString(), "2026-10-08T12:00:00.000Z");
  assert.equal(isDisputeWindowOpen(new Date("2026-10-08T11:59:59.999Z"), deadline), true);
  assert.equal(isDisputeWindowOpen(deadline, deadline), false);
  assert.equal(isDisputeWindowOpen(new Date("2026-10-08T12:00:00.001Z"), deadline), false);
});

test("policy window accepts only whole days from zero through thirty", () => {
  for (const value of [0, 7, 30]) assert.equal(isValidDisputeWindowDays(value), true);
  for (const value of [-1, 1.5, 31, "7", null]) assert.equal(isValidDisputeWindowDays(value), false);
});

test("damage claim must be positive and cannot exceed held deposit", () => {
  const base = { heldDeposit: 100, rentalText: "Scratch", issueType: "body", attachmentCount: 1 };
  assert.equal(validateDamageDisputeInput({ ...base, damagedCharges: 100 }), null);
  assert.equal(validateDamageDisputeInput({ ...base, damagedCharges: 100.01 }), "amountExceedsDeposit");
  assert.equal(validateDamageDisputeInput({ ...base, damagedCharges: 0 }), "invalidAmount");
  assert.equal(validateDamageDisputeInput({ ...base, damagedCharges: 0.001 }), "invalidAmount");
  assert.equal(validateDamageDisputeInput({ ...base, damagedCharges: 1, attachmentCount: 6 }), "invalidAttachments");
});

test("refund idempotency key is deterministic per settlement and outcome-independent", () => {
  const first = buildDepositRefundIdempotencyKey("booking", "auto-window-v1");
  assert.equal(first, buildDepositRefundIdempotencyKey("booking", "auto-window-v1"));
  assert.notEqual(first, buildDepositRefundIdempotencyKey("booking", "dispute-1"));
  assert.equal(first.includes("5000"), false);
  assert.ok(first.length <= 255);
});

test("only booking parties can invoke booking-scoped mutations", () => {
  const booking = { renterId: "renter", leaserId: "lessor" };
  assert.equal(isBookingParty({ ...booking, userId: "renter" }), true);
  assert.equal(isBookingParty({ ...booking, userId: "lessor" }), true);
  assert.equal(isBookingParty({ ...booking, userId: "other" }), false);
  assert.equal(isBookingParty({ ...booking, userId: undefined }), false);
});

test("only Admin and booking parties can read a dispute", () => {
  const base = { userId: "renter", renterId: "renter", leaserId: "lessor" };
  assert.equal(canReadDamageDispute({ ...base, role: "user" }), true);
  assert.equal(canReadDamageDispute({ ...base, role: "admin", userId: "admin" }), true);
  assert.equal(canReadDamageDispute({ ...base, role: "user", userId: "other" }), false);
});
