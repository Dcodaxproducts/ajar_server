import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative: string) =>
  readFileSync(`${process.cwd()}/src/${relative.replace(/^\.\.\//, "")}`, "utf8");

test("refund request admin routes require authentication and Admin role", () => {
  const routes = source("../routes/refundRequests.routes.ts");
  assert.match(routes, /router\.use\(useAuth, adminOnly\)/);
  assert.doesNotMatch(routes, /router\.(patch|delete)\("\/:id"/);
});

test("renter refund routes are read-only after submission and owner scoped", () => {
  const routes = source("../routes/refundManagement.routes.ts");
  const controller = source("../controllers/refundManagement.controller.ts");
  assert.match(routes, /router\.get\("\/user\/:id", useAuth, userOnly/);
  assert.doesNotMatch(routes, /router\.(patch|delete)\("\/user\/:id"/);
  assert.match(controller, /RefundRequest\.findOne\(\{ _id: id, user: userId \}\)/);
  assert.match(controller, /renterId !== user\.id\.toString\(\)/);
});

test("refund acceptance has durable processing state and deterministic Stripe key", () => {
  const controller = source("../controllers/refundRequest.controller.ts");
  const payment = source("../utils/bookingStripePayments.ts");
  assert.match(controller, /status: "processing"/);
  assert.match(controller, /outstandingLines/);
  assert.match(payment, /idempotencyKey: buildBookingRefundIdempotencyKey/);
  assert.match(payment, /refund\.status !== "succeeded"/);
});
