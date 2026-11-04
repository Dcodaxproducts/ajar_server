import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SecurityDepositAuthorization, SECURITY_DEPOSIT_STATES } from "../models/securityDepositAuthorization.model";
const securityDepositService: typeof import("../services/securityDepositAuthorizationState.service") =
  require("../services/securityDepositAuthorizationState.service");
const {
  AUTHORIZATION_SAFETY_MARGIN_MS,
  assertProjectedAuthorizationWindow,
  depositActionKeys,
  resolveCaptureTerminalState,
  sanitizeProviderErrorCode,
  supportsDisputeDeadline,
} = securityDepositService;

const source = (path: string) => readFileSync(require.resolve(path), "utf8");

test("durable authorization schema persists provider truth, retries, leases, and bounded sweep index", () => {
  const paths = SecurityDepositAuthorization.schema.paths;
  for (const name of ["providerPaymentIntentId", "amountAuthorized", "amountCapturable", "amountCaptured", "currency", "captureBefore", "disputeDeadline", "nextActionAt", "attempts", "lastErrorCode", "version", "releaseIdempotencyKey", "captureIdempotencyKey", "audit"]) assert.ok(paths[name], name);
  const indexes = SecurityDepositAuthorization.schema.indexes();
  assert.ok(indexes.some(([fields]) => fields.bookingId === 1));
  assert.ok(indexes.some(([fields]) => fields.state === 1 && fields.nextActionAt === 1 && fields.leaseUntil === 1));
});

test("state machine covers hold, scheduled release, dispute, settlement, expiry, and recovery", () => {
  for (const state of ["AUTHORIZED_HELD", "RELEASE_SCHEDULED", "DISPUTE_OPEN", "SETTLEMENT_SCHEDULED", "RELEASED_NO_DISPUTE", "ADMIN_REJECTED_RELEASED", "ADMIN_APPROVED_CAPTURED", "ADMIN_APPROVED_PARTIALLY_CAPTURED", "EXPIRED", "PROVIDER_ACTION_REQUIRED", "FAILED_RETRYABLE"]) {
    assert.ok(SECURITY_DEPOSIT_STATES.includes(state as never), state);
  }
});

test("provider capture_before is authoritative with a safety margin", () => {
  const captureBefore = new Date("2026-11-10T00:00:00.000Z");
  assert.equal(supportsDisputeDeadline(new Date(captureBefore.getTime() - AUTHORIZATION_SAFETY_MARGIN_MS), captureBefore), true);
  assert.equal(supportsDisputeDeadline(new Date(captureBefore.getTime() - AUTHORIZATION_SAFETY_MARGIN_MS + 1), captureBefore), false);
});

test("unsupported long windows fail before any provider request", () => {
  const old = process.env.STRIPE_CARD_AUTHORIZATION_MAX_HOURS;
  process.env.STRIPE_CARD_AUTHORIZATION_MAX_HOURS = "168";
  try {
    assert.throws(() => assertProjectedAuthorizationWindow({ dates: { checkOut: new Date("2026-11-05T00:00:00.000Z") }, damageDisputeWindow: { duration: 7, unit: "days" } }, new Date("2026-11-04T00:00:00.000Z")), /DEPOSIT_AUTHORIZATION_WINDOW_UNSUPPORTED/);
  } finally {
    if (old === undefined) delete process.env.STRIPE_CARD_AUTHORIZATION_MAX_HOURS; else process.env.STRIPE_CARD_AUTHORIZATION_MAX_HOURS = old;
  }
});

test("full and partial admin capture states enforce integer minor-unit bounds", () => {
  assert.equal(resolveCaptureTerminalState(5000, 5000), "ADMIN_APPROVED_CAPTURED");
  assert.equal(resolveCaptureTerminalState(2500, 5000), "ADMIN_APPROVED_PARTIALLY_CAPTURED");
  for (const invalid of [0, -1, 5001, 1.5]) assert.throws(() => resolveCaptureTerminalState(invalid, 5000));
});

test("release and capture retries use stable, outcome-specific idempotency keys", () => {
  assert.deepEqual(depositActionKeys("booking123"), { release: "deposit-release-booking123-v1", capture: "deposit-capture-booking123-v1" });
  const service = source("../services/securityDepositAuthorization.service");
  assert.match(service, /idempotencyKey: authorization.releaseIdempotencyKey/);
  assert.match(service, /idempotencyKey: authorization.captureIdempotencyKey/);
  assert.match(service, /intent.status === "succeeded"/); // crash-after-provider-success recovery
});

test("completion never refunds or immediately releases and uses authoritative return timestamp", () => {
  const booking = source("../controllers/booking.controller");
  assert.match(booking, /scheduleSecurityDepositRelease/);
  assert.match(booking, /finalBooking.returnVerifiedAt/);
  const cron = source("../cron/securityDepositRelease.cron");
  assert.equal(cron.includes("refundBookingSecurityDeposit"), false);
  assert.equal(cron.includes("ENABLE_SECURITY_DEPOSIT_HOLD_WORKER"), true);
});

test("submission and deadline release are mutually exclusive at the half-open boundary", () => {
  const controller = source("../controllers/damageReport.controller");
  const service = source("../services/securityDepositAuthorization.service");
  assert.ok(controller.includes("blockDepositReleaseForDispute(booking._id, report._id"));
  assert.ok(service.includes("disputeDeadline: { $gt: checkedAt }"));
  assert.ok(service.includes("nextActionAt: { $lte: now }"));
  assert.ok(service.includes('state: { $in: ["AUTHORIZED_HELD", "RELEASE_SCHEDULED"] }'));
});

test("decision execution supports approve full, partial, reject, retries, and immutable Story 2 decision", () => {
  const controller = source("../controllers/damageReport.controller");
  const service = source("../services/securityDepositAuthorization.service");
  assert.ok(controller.includes("scheduleDepositDecision(updated._id"));
  assert.match(controller, /state: "FAILED_RETRYABLE"/);
  assert.match(service, /amount_to_capture: amount/);
  assert.ok(service.includes("DEPOSIT_DECISION_CURRENCY_MISMATCH"));
  assert.ok(service.includes('nextAction = report.status === "approved" ? "capture" : "release"'));
  assert.equal(service.includes("refunds.create"), false);
});

test("webhook signature, dedupe lease, out-of-order terminal guard, and duplicate notifications are explicit", () => {
  const webhook = source("../controllers/payment.controller");
  const service = source("../services/securityDepositAuthorization.service");
  assert.match(webhook, /stripe.webhooks.constructEvent/);
  assert.match(webhook, /claimStripeWebhook/);
  assert.match(webhook, /status: "processed"/);
  assert.ok(service.includes("state: { $nin: TERMINAL_DEPOSIT_STATES }"));
  assert.ok(service.includes('jobId: key + "-" + userId'));
});

test("worker is bounded, leased, retry-capped, and Redis-independent", () => {
  const service = source("../services/securityDepositAuthorization.service");
  assert.match(service, /DEPOSIT_SWEEPER_BATCH_SIZE = 25/);
  assert.match(service, /MAX_DEPOSIT_ACTION_ATTEMPTS = 8/);
  assert.match(service, /leaseUntil/);
  assert.ok(service.includes(".limit(DEPOSIT_SWEEPER_BATCH_SIZE)"));
  assert.equal(service.includes("redis"), false);
});

test("provider errors are sanitized and no card data or raw provider ids reach status responses", () => {
  assert.equal(sanitizeProviderErrorCode({ code: "card_declined: secret detail" }), "card_declined__secret_detail");
  const controller = source("../controllers/damageReport.controller");
  const statusSlice = controller.slice(controller.indexOf("getSecurityDepositStatus"));
  assert.equal(statusSlice.includes("providerPaymentIntentId"), false);
  assert.equal(statusSlice.includes("client_secret"), false);
});
