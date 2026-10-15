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
  assert.doesNotMatch(routes, /router\.patch\("\/admin\/:id\/status"/);
  assert.match(controller, /RefundRequest\.findOne\(\{ _id: id, user: userId \}\)/);
  assert.match(controller, /renterId !== user\.id\.toString\(\)/);
});

test("booking cancellation and refund-policy writes enforce the owning renter/Admin roles", () => {
  const booking = source("../controllers/booking.controller.ts");
  const policies = source("../routes/refundPolicies.routes.ts");
  assert.match(booking, /cancellationStatuses\.includes\(finalStatus\) && !isRenter/);
  assert.match(policies, /router\.patch\("\/:zone\/:subCategory", useAuth, adminOnly/);
  assert.match(policies, /router\.delete\("\/:id", useAuth, adminOnly/);
});

test("field mutations are Admin-only and paged search is server-side", () => {
  const routes = source("../routes/field.routes.ts");
  const controller = source("../controllers/field.controller.ts");
  assert.match(routes, /router\.delete\("\/:id", useAuth, adminOnly/);
  assert.match(controller, /req\.query\.search/);
  assert.match(controller, /Math\.min\(200/);
});

test("deposit release uses an expiring ownership lease and damage settlement fails closed", () => {
  const cron = source("../cron/securityDepositRelease.cron.ts");
  const damage = source("../controllers/damageReport.controller.ts");
  assert.match(cron, /depositReleaseLockToken: lockToken/);
  assert.match(cron, /depositReleaseLockedAt: \{ \$lte: staleBefore \}/);
  assert.match(damage, /Captured booking payment not found for damage settlement/);
  assert.match(damage, /Math\.round\(parsedAmount \* 100\)/);
});

test("refund acceptance has durable processing state and deterministic Stripe key", () => {
  const controller = source("../controllers/refundRequest.controller.ts");
  const payment = source("../utils/bookingStripePayments.ts");
  assert.match(controller, /status: "processing"/);
  assert.match(controller, /outstandingLines/);
  assert.match(payment, /idempotencyKey: buildBookingRefundIdempotencyKey/);
  assert.match(payment, /refund\.status !== "succeeded"/);
});
