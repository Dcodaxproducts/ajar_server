import test from "node:test";
import assert from "node:assert/strict";
import { DamageReport } from "../models/damageReport.model";
import {
  DAMAGE_DISPUTE_ERROR_CODES,
  DEFAULT_DAMAGE_DISPUTE_WINDOW,
  calculateDamageDisputeDeadline,
  evaluateDamageDisputeEligibility,
  isDamageDisputeLessor,
  isDamageDisputeWindowConfig,
  resolveDamageDisputeWindow,
} from "../services/damageDisputeWindow.service";

const returnedAt = new Date("2026-03-07T17:30:00.000Z");
const completedBooking = {
  status: "completed",
  returnVerifiedAt: returnedAt,
  damageDisputeWindow: { duration: 7, unit: "days" as const },
};

test("window is open just before, closed at, and closed just after deadline", () => {
  const deadline = calculateDamageDisputeDeadline(
    returnedAt,
    completedBooking.damageDisputeWindow
  );

  assert.equal(deadline.toISOString(), "2026-03-14T17:30:00.000Z");
  assert.equal(
    evaluateDamageDisputeEligibility(
      completedBooking,
      new Date(deadline.getTime() - 1)
    ).state,
    "open"
  );
  assert.equal(
    evaluateDamageDisputeEligibility(completedBooking, deadline).state,
    "expired"
  );
  assert.equal(
    evaluateDamageDisputeEligibility(
      completedBooking,
      new Date(deadline.getTime() + 1)
    ).state,
    "expired"
  );
});

test("UTC elapsed-time calculation is DST independent", () => {
  // This range crosses the 2026 US spring-forward boundary. Seven days remain
  // exactly 168 hours rather than a locale-dependent calendar duration.
  const deadline = calculateDamageDisputeDeadline(returnedAt, {
    duration: 7,
    unit: "days",
  });
  assert.equal(deadline.getTime() - returnedAt.getTime(), 168 * 60 * 60 * 1000);
  assert.equal(deadline.toISOString(), "2026-03-14T17:30:00.000Z");
});

test("missing and invalid configuration safely resolve to seven days", () => {
  assert.deepEqual(resolveDamageDisputeWindow({}), DEFAULT_DAMAGE_DISPUTE_WINDOW);
  assert.deepEqual(
    resolveDamageDisputeWindow({
      damageDisputeWindow: { duration: 31, unit: "days" },
      depositDisputeWindowDays: -1,
    }),
    DEFAULT_DAMAGE_DISPUTE_WINDOW
  );
  assert.equal(isDamageDisputeWindowConfig({ duration: 1, unit: "hours" }), true);
  assert.equal(isDamageDisputeWindowConfig({ duration: 720, unit: "hours" }), true);
  assert.equal(isDamageDisputeWindowConfig({ duration: 721, unit: "hours" }), false);
  assert.equal(isDamageDisputeWindowConfig({ duration: 30, unit: "days" }), true);
  assert.equal(isDamageDisputeWindowConfig({ duration: 0, unit: "days" }), false);
});

test("legacy day configuration remains compatible", () => {
  assert.deepEqual(
    resolveDamageDisputeWindow({ depositDisputeWindowDays: 5 }),
    { duration: 5, unit: "days" }
  );
});

test("only the booking lessor is authorized", () => {
  assert.equal(isDamageDisputeLessor("lessor", "lessor"), true);
  assert.equal(isDamageDisputeLessor("renter", "lessor"), false);
  assert.equal(isDamageDisputeLessor("other-lessor", "lessor"), false);
  assert.equal(isDamageDisputeLessor(undefined, "lessor"), false);
});

test("completed and verified early-return bookings are eligible states", () => {
  assert.equal(
    evaluateDamageDisputeEligibility(completedBooking, returnedAt).state,
    "open"
  );
  assert.equal(
    evaluateDamageDisputeEligibility(
      {
        ...completedBooking,
        status: "booking_cancelled",
        cancelledFromStatus: "in_progress",
      },
      returnedAt
    ).state,
    "open"
  );
  assert.equal(
    evaluateDamageDisputeEligibility(
      { ...completedBooking, status: "in_progress" },
      returnedAt
    ).state,
    "wrong_status"
  );
  assert.equal(
    evaluateDamageDisputeEligibility(
      {
        ...completedBooking,
        status: "booking_cancelled",
        cancelledFromStatus: "approved",
      },
      returnedAt
    ).state,
    "wrong_status"
  );
});

test("verified return instant is mandatory and authoritative", () => {
  const noVerifiedReturn = evaluateDamageDisputeEligibility(
    {
      status: "completed",
      damageDisputeWindow: { duration: 7, unit: "days" },
    },
    returnedAt
  );
  assert.equal(noVerifiedReturn.state, "not_returned");
  assert.equal(noVerifiedReturn.rentalEndAt, null);

  const eligibility = evaluateDamageDisputeEligibility(
    completedBooking,
    returnedAt
  );
  assert.equal(eligibility.rentalEndAt?.toISOString(), returnedAt.toISOString());
});

test("rental-end correction deterministically moves the deadline", () => {
  const first = evaluateDamageDisputeEligibility(completedBooking, returnedAt);
  const correctedReturn = new Date(returnedAt.getTime() + 60 * 60 * 1000);
  const corrected = evaluateDamageDisputeEligibility(
    { ...completedBooking, returnVerifiedAt: correctedReturn },
    returnedAt
  );

  assert.equal(
    corrected.deadlineAt!.getTime() - first.deadlineAt!.getTime(),
    60 * 60 * 1000
  );
});

test("existing dispute closes eligibility and exposes stable API codes", () => {
  const duplicate = evaluateDamageDisputeEligibility(
    { ...completedBooking, damageDisputeId: "existing" },
    returnedAt
  );
  assert.equal(duplicate.state, "already_submitted");
  assert.equal(DAMAGE_DISPUTE_ERROR_CODES.already_submitted, "DAMAGE_DISPUTE_ALREADY_SUBMITTED");
  assert.equal(DAMAGE_DISPUTE_ERROR_CODES.notFound, "DAMAGE_DISPUTE_BOOKING_NOT_FOUND");
  assert.equal(DAMAGE_DISPUTE_ERROR_CODES.expired, "DAMAGE_DISPUTE_WINDOW_EXPIRED");
});

test("unique booking index is the deterministic duplicate/concurrency invariant", () => {
  const bookingIndex = DamageReport.schema.indexes().find(
    ([fields]) => fields.booking === 1
  );
  assert.ok(bookingIndex);
  assert.equal(bookingIndex[1].unique, true);
});
