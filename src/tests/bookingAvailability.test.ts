import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_BOOKING_STATUSES,
  availabilityCheckInForUnit,
  blackoutDatesOverlapRange,
  bookingBlocksInventory,
  dateRangesOverlap,
} from "../utils/bookingAvailability";

test("only inventory-reserving booking states block availability", () => {
  assert.deepEqual(ACTIVE_BOOKING_STATUSES, ["approved", "in_progress"]);
  for (const status of ["approved", "in_progress"]) {
    assert.equal(bookingBlocksInventory(status, false), true);
  }
  assert.equal(bookingBlocksInventory("pending", true), true);
  assert.equal(bookingBlocksInventory("pending", false), false);
  for (const status of ["request_cancelled", "booking_cancelled", "cancelled", "canceled", "rejected", "expired", "failed", "completed"]) {
    assert.equal(bookingBlocksInventory(status, true), false, status);
  }
});

test("overlap uses existing inclusive boundaries", () => {
  const existingStart = new Date("2026-10-10T00:00:00.000Z");
  const existingEnd = new Date("2026-10-12T23:59:59.999Z");
  assert.equal(dateRangesOverlap(existingStart, existingEnd, new Date("2026-10-12T23:59:59.999Z"), new Date("2026-10-13T10:00:00.000Z")), true);
  assert.equal(dateRangesOverlap(existingStart, existingEnd, new Date("2026-10-13T00:00:00.000Z"), new Date("2026-10-14T00:00:00.000Z")), false);
  const adjacentHourlyStart = availabilityCheckInForUnit(existingEnd, "hour");
  assert.equal(adjacentHourlyStart.getTime(), existingEnd.getTime() + 1);
  assert.equal(dateRangesOverlap(existingStart, existingEnd, adjacentHourlyStart, new Date("2026-10-13T01:00:00.000Z")), false);
  assert.equal(availabilityCheckInForUnit(existingEnd, "day"), existingEnd);
});

test("listing blackout dates remain authoritative and UTC date based", () => {
  assert.equal(blackoutDatesOverlapRange(["2026-10-11"], new Date("2026-10-10T23:00:00.000Z"), new Date("2026-10-11T00:00:00.000Z")), true);
  assert.equal(blackoutDatesOverlapRange(["2026-10-12"], new Date("2026-10-10T00:00:00.000Z"), new Date("2026-10-11T23:59:59.999Z")), false);
});

test("calendar, cancellation, approval, and payment paths share the invariant", async () => {
  const fs = await import("node:fs/promises");
  const [calendar, booking, payments] = await Promise.all([
    fs.readFile("src/controllers/marketplaceListings.controller.ts", "utf8"),
    fs.readFile("src/controllers/booking.controller.ts", "utf8"),
    fs.readFile("src/utils/bookingStripePayments.ts", "utf8"),
  ]);

  assert.match(calendar, /status: \{ \$in: \[...ACTIVE_BOOKING_STATUSES, "pending"\] \}/);
  assert.match(calendar, /Cache-Control", "no-store"/);
  assert.match(booking, /parentBooking.status === finalStatus/);
  assert.match(booking, /finalStatus === "request_cancelled" && parentBooking.status !== "pending"/);
  assert.match(booking, /lockAndCheckBookingAvailability\(/);
  assert.match(booking, /status: \{ \$in: ACTIVE_BOOKING_STATUSES \}/);
  assert.match(booking, /previousBookingId: parentBooking._id[\s\S]*status: "booking_cancelled"/);
  assert.match(payments, /withTransaction/);
  assert.match(payments, /booking.status !== "pending"/);
  assert.match(payments, /booking-conflict-cancel/);
});
