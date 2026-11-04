import mongoose from "mongoose";
import Stripe from "stripe";
import { Booking } from "../models/booking.model";
import { DamageReport } from "../models/damageReport.model";
import { Payment } from "../models/payment.model";
import { notificationQueue } from "../queues/notification.queue";
import { createTransaction } from "../utils/transactionLedger";
import { SecurityDepositAuthorization, SecurityDepositState } from "../models/securityDepositAuthorization.model";
import stripe from "../utils/stripe";
import { calculateDamageDisputeDeadline, resolveDamageDisputeWindow } from "./damageDisputeWindow.service";
import {
  AUTHORIZATION_SAFETY_MARGIN_MS,
  depositActionKeys,
  extractCaptureBefore,
  resolveCaptureTerminalState,
  sanitizeProviderErrorCode,
  supportsDisputeDeadline,
} from "./securityDepositAuthorizationState.service";
export {
  AUTHORIZATION_SAFETY_MARGIN_MS,
  assertProjectedAuthorizationWindow,
  depositActionKeys,
  providerAuthorizationUpperBound,
  resolveCaptureTerminalState,
  sanitizeProviderErrorCode,
  supportsDisputeDeadline,
} from "./securityDepositAuthorizationState.service";

export const DEPOSIT_SWEEPER_BATCH_SIZE = 25;
export const DEPOSIT_LEASE_MS = 2 * 60 * 1000;
export const MAX_DEPOSIT_ACTION_ATTEMPTS = 8;
export const TERMINAL_DEPOSIT_STATES: readonly SecurityDepositState[] = [
  "RELEASED_NO_DISPUTE", "ADMIN_REJECTED_RELEASED", "ADMIN_APPROVED_CAPTURED",
  "ADMIN_APPROVED_PARTIALLY_CAPTURED", "EXPIRED",
];

const renterId = (value: unknown): mongoose.Types.ObjectId => {
  const candidate = value as mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId };
  const id = candidate instanceof mongoose.Types.ObjectId ? candidate : candidate?._id;
  if (!id) throw new Error("DEPOSIT_RENTER_NOT_FOUND");
  return id;
};

export const registerSecurityDepositAuthorization = async (intent: Stripe.PaymentIntent, session?: mongoose.ClientSession) => {
  const bookingId = intent.metadata?.bookingId;
  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId) || intent.metadata?.paymentPurpose !== "security_deposit") {
    throw new Error("DEPOSIT_METADATA_INVALID");
  }
  if (intent.status !== "requires_capture") throw new Error("DEPOSIT_AUTHORIZATION_NOT_CAPTURABLE");
  const booking = await Booking.findById(bookingId).session(session || null);
  if (!booking) throw new Error("DEPOSIT_BOOKING_NOT_FOUND");
  const amount = Math.round(Number(booking.priceDetails.securityDeposit || 0) * 100);
  if (amount <= 0 || intent.amount_capturable !== amount) throw new Error("DEPOSIT_AUTHORIZATION_AMOUNT_MISMATCH");
  if (intent.currency.toLowerCase() !== "usd") throw new Error("DEPOSIT_AUTHORIZATION_CURRENCY_MISMATCH");
  const captureBefore = extractCaptureBefore(intent);
  const deadline = calculateDamageDisputeDeadline(booking.dates.checkOut, resolveDamageDisputeWindow(booking));
  const supported = Boolean(captureBefore && supportsDisputeDeadline(deadline, captureBefore));
  const safeCaptureBefore = captureBefore || new Date();
  const state: SecurityDepositState = supported ? "AUTHORIZED_HELD" : "PROVIDER_ACTION_REQUIRED";
  const keys = depositActionKeys(bookingId);
  return SecurityDepositAuthorization.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $setOnInsert: {
        bookingId: booking._id, renterId: renterId(booking.renter), provider: "stripe",
        providerPaymentIntentId: intent.id, amountAuthorized: amount, amountCaptured: 0,
        currency: intent.currency.toLowerCase(), releaseIdempotencyKey: keys.release,
        captureIdempotencyKey: keys.capture, notificationKeys: [], attempts: 0, version: 0,
      },
      $set: {
        amountCapturable: intent.amount_capturable, providerStatus: intent.status,
        captureBefore: safeCaptureBefore, disputeDeadline: deadline, state,
        nextAction: supported ? null : "release",
        nextActionAt: supported ? deadline : new Date(Math.max(Date.now(), safeCaptureBefore.getTime() - AUTHORIZATION_SAFETY_MARGIN_MS)),
        lastErrorCode: supported ? undefined : "AUTHORIZATION_WINDOW_UNSUPPORTED",
      },
      $push: { audit: { event: "authorization_confirmed", at: new Date(), toState: state } },
    },
    { upsert: true, new: true, runValidators: true, session }
  );
};

export const scheduleSecurityDepositRelease = async (bookingId: mongoose.Types.ObjectId | string, returnedAt: Date, session?: mongoose.ClientSession) => {
  const booking = await Booking.findById(bookingId).session(session || null);
  if (!booking) throw new Error("DEPOSIT_BOOKING_NOT_FOUND");
  const authorization = await SecurityDepositAuthorization.findOne({ bookingId }).session(session || null);
  if (!authorization && Number(booking.priceDetails.securityDeposit || 0) > 0) throw new Error("DEPOSIT_AUTHORIZATION_NOT_FOUND");
  if (!authorization) return null;
  const deadline = calculateDamageDisputeDeadline(returnedAt, resolveDamageDisputeWindow(booking));
  const supported = supportsDisputeDeadline(deadline, authorization.captureBefore);
  const state: SecurityDepositState = supported ? "RELEASE_SCHEDULED" : "PROVIDER_ACTION_REQUIRED";
  return SecurityDepositAuthorization.findOneAndUpdate(
    { _id: authorization._id, state: { $in: ["AUTHORIZED_HELD", "RELEASE_SCHEDULED", "PROVIDER_ACTION_REQUIRED"] } },
    {
      $set: {
        disputeDeadline: deadline, state, nextAction: "release",
        nextActionAt: supported ? deadline : new Date(Math.max(Date.now(), authorization.captureBefore.getTime() - AUTHORIZATION_SAFETY_MARGIN_MS)),
        lastErrorCode: supported ? undefined : "AUTHORIZATION_WINDOW_UNSUPPORTED",
      },
      $inc: { version: 1 },
      $push: { audit: { event: "return_verified", at: new Date(), fromState: authorization.state, toState: state } },
    },
    { new: true, session, runValidators: true }
  );
};

export const scheduleCancelledBookingDepositRelease = async (
  bookingId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
) => SecurityDepositAuthorization.findOneAndUpdate(
  { bookingId, state: { $in: ["AUTHORIZED_HELD", "RELEASE_SCHEDULED", "PROVIDER_ACTION_REQUIRED"] } },
  {
    $set: { state: "RELEASE_SCHEDULED", nextAction: "release", nextActionAt: new Date() },
    $unset: { leaseUntil: 1, lastErrorCode: 1 },
    $inc: { version: 1 },
    $push: { audit: { event: "booking_cancelled", at: new Date(), toState: "RELEASE_SCHEDULED" } },
  },
  { new: true, session }
);

export const blockDepositReleaseForDispute = async (bookingId: mongoose.Types.ObjectId | string, disputeId: mongoose.Types.ObjectId, checkedAt: Date, session: mongoose.ClientSession) => {
  const authorization = await SecurityDepositAuthorization.findOneAndUpdate(
    { bookingId, state: { $in: ["AUTHORIZED_HELD", "RELEASE_SCHEDULED"] }, disputeDeadline: { $gt: checkedAt } },
    {
      $set: { state: "DISPUTE_OPEN", disputeId, nextAction: null },
      $unset: { leaseUntil: 1, lastErrorCode: 1 }, $inc: { version: 1 },
      $push: { audit: { event: "dispute_opened", at: checkedAt, toState: "DISPUTE_OPEN" } },
    }, { new: true, session }
  );
  if (!authorization) throw new Error("DEPOSIT_RELEASE_ALREADY_CLAIMED");
  return authorization;
};

export const scheduleDepositDecision = async (disputeId: mongoose.Types.ObjectId | string) => {
  const report = await DamageReport.findById(disputeId).lean();
  if (!report || !["approved", "rejected"].includes(report.status)) return null;
  const authorization = await SecurityDepositAuthorization.findOne({ bookingId: report.booking });
  if (!authorization) return null;
  if (report.status === "approved" && report.currency.toLowerCase() !== authorization.currency.toLowerCase()) {
    return SecurityDepositAuthorization.findOneAndUpdate(
      { _id: authorization._id, state: { $in: ["DISPUTE_OPEN", "FAILED_RETRYABLE", "SETTLEMENT_SCHEDULED"] } },
      { $set: { state: "PROVIDER_ACTION_REQUIRED", nextAction: null, lastErrorCode: "DEPOSIT_DECISION_CURRENCY_MISMATCH" }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } },
      { new: true }
    );
  }
  const nextAction = report.status === "approved" ? "capture" : "release";
  return SecurityDepositAuthorization.findOneAndUpdate(
    { bookingId: report.booking, state: { $in: ["DISPUTE_OPEN", "FAILED_RETRYABLE", "SETTLEMENT_SCHEDULED"] } },
    {
      $set: { disputeId: report._id, state: "SETTLEMENT_SCHEDULED", nextAction, nextActionAt: new Date(), approvedAmount: Math.round(Number(report.approvedAmount || 0) * 100) },
      $unset: { leaseUntil: 1, lastErrorCode: 1 }, $inc: { version: 1 },
      $push: { audit: { event: "admin_decision_recorded", at: new Date(), toState: "SETTLEMENT_SCHEDULED", amount: Math.round(Number(report.approvedAmount || 0) * 100) } },
    }, { new: true }
  );
};

const claimNextAuthorization = (now: Date) => SecurityDepositAuthorization.findOneAndUpdate(
  {
    state: { $in: ["RELEASE_SCHEDULED", "SETTLEMENT_SCHEDULED", "FAILED_RETRYABLE", "PROVIDER_ACTION_REQUIRED"] },
    nextAction: { $in: ["release", "capture"] }, nextActionAt: { $lte: now }, attempts: { $lt: MAX_DEPOSIT_ACTION_ATTEMPTS },
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
  },
  { $set: { leaseUntil: new Date(now.getTime() + DEPOSIT_LEASE_MS) }, $inc: { attempts: 1 } },
  { new: true, sort: { nextActionAt: 1, _id: 1 } }
);

const notifyTerminalState = async (authorizationId: mongoose.Types.ObjectId, state: SecurityDepositState) => {
  const authorization = await SecurityDepositAuthorization.findById(authorizationId).lean();
  if (!authorization) return;
  const key = "deposit-terminal-" + authorizationId.toString() + "-" + state;
  if (authorization.notificationKeys.includes(key)) return;
  const booking = await Booking.findById(authorization.bookingId).select("renter leaser").lean();
  const recipients = [booking?.renter, booking?.leaser].filter(Boolean).map(String);
  await Promise.all(recipients.map((userId) => notificationQueue.add(
    "security-deposit-terminal",
    { userId, title: "Security deposit updated", message: state.includes("CAPTURED") ? "The approved damage settlement was completed." : "The security-deposit authorization was released.", data: { bookingId: String(authorization.bookingId), type: "security_deposit", state } },
    { jobId: key + "-" + userId }
  )));
  await SecurityDepositAuthorization.updateOne({ _id: authorizationId }, { $addToSet: { notificationKeys: key } });
};

const recordCapturedSettlement = async (authorization: InstanceType<typeof SecurityDepositAuthorization>, amount: number) => {
  const booking = await Booking.findById(authorization.bookingId).select("leaser").lean();
  if (!booking?.leaser) throw new Error("DEPOSIT_LEASER_NOT_FOUND");
  const payment = await Payment.findOneAndUpdate(
    { paymentIntentId: authorization.providerPaymentIntentId },
    { bookingId: authorization.bookingId, userId: authorization.renterId, amount: amount / 100, currency: authorization.currency, type: "damage", status: "captured", paymentIntentId: authorization.providerPaymentIntentId, capturedAt: new Date(), method: "stripe" },
    { upsert: true, new: true }
  );
  const leaser = booking.leaser as mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId };
  const leaserId = leaser instanceof mongoose.Types.ObjectId ? leaser : leaser._id;
  if (!leaserId) throw new Error("DEPOSIT_LEASER_NOT_FOUND");
  await createTransaction({ paymentId: payment._id as mongoose.Types.ObjectId, userId: leaserId, amount: amount / 100, type: "credit", source: "damage_charge" });
};

const executeProviderAction = async (authorization: InstanceType<typeof SecurityDepositAuthorization>) => {
  let intent = await stripe.paymentIntents.retrieve(authorization.providerPaymentIntentId, { expand: ["latest_charge"] });
  if (authorization.nextAction === "release") {
    if (intent.status === "requires_capture") {
      intent = await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: authorization.releaseIdempotencyKey });
    }
    if (intent.status !== "canceled") throw Object.assign(new Error("DEPOSIT_RELEASE_NOT_CONFIRMED"), { code: "release_not_confirmed" });
    const state: SecurityDepositState = authorization.disputeId ? "ADMIN_REJECTED_RELEASED" : "RELEASED_NO_DISPUTE";
    const result = await SecurityDepositAuthorization.updateOne(
      { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
      { $set: { state, providerStatus: intent.status, amountCapturable: 0, nextAction: null }, $unset: { leaseUntil: 1, lastErrorCode: 1 }, $inc: { version: 1 }, $push: { audit: { event: "provider_release_confirmed", at: new Date(), fromState: authorization.state, toState: state, idempotencyKey: authorization.releaseIdempotencyKey } } }
    );
    if (result.modifiedCount === 1) {
      await Booking.updateOne({ _id: authorization.bookingId }, { $set: { depositStatus: "released", depositReleasedAt: new Date() } });
      await notifyTerminalState(authorization._id as mongoose.Types.ObjectId, state);
    }
    return;
  }
  const amount = Number(authorization.approvedAmount || 0);
  if (amount <= 0 || amount > authorization.amountAuthorized) {
    throw Object.assign(new Error("DEPOSIT_CAPTURE_AMOUNT_INVALID"), { code: "capture_amount_invalid" });
  }
  if (intent.status === "requires_capture") {
    if (amount > intent.amount_capturable) throw Object.assign(new Error("DEPOSIT_CAPTURE_AMOUNT_INVALID"), { code: "capture_amount_invalid" });
    intent = await stripe.paymentIntents.capture(intent.id, { amount_to_capture: amount, metadata: { disputeId: String(authorization.disputeId || "") } }, { idempotencyKey: authorization.captureIdempotencyKey });
  }
  if (intent.status !== "succeeded" || Number(intent.amount_received || 0) < amount) throw Object.assign(new Error("DEPOSIT_CAPTURE_NOT_CONFIRMED"), { code: "capture_not_confirmed" });
  const state = resolveCaptureTerminalState(amount, authorization.amountAuthorized);
  await recordCapturedSettlement(authorization, amount);
  const result = await SecurityDepositAuthorization.updateOne(
    { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
    { $set: { state, providerStatus: intent.status, amountCaptured: amount, amountCapturable: 0, nextAction: null }, $unset: { leaseUntil: 1, lastErrorCode: 1 }, $inc: { version: 1 }, $push: { audit: { event: "provider_capture_confirmed", at: new Date(), fromState: authorization.state, toState: state, amount, idempotencyKey: authorization.captureIdempotencyKey } } }
  );
  if (result.modifiedCount === 1) {
    await Booking.updateOne({ _id: authorization.bookingId }, { $set: { depositStatus: amount === authorization.amountAuthorized ? "deducted" : "partially_refunded" } });
    await notifyTerminalState(authorization._id as mongoose.Types.ObjectId, state);
  }
};

export const reconcileDepositDecisions = async () => {
  const open = await SecurityDepositAuthorization.find({ state: "DISPUTE_OPEN" }).select("disputeId").limit(DEPOSIT_SWEEPER_BATCH_SIZE).lean();
  for (const item of open) if (item.disputeId) await scheduleDepositDecision(item.disputeId);
};

export const reconcileTerminalDepositSideEffects = async () => {
  const terminal = await SecurityDepositAuthorization.find({ state: { $in: TERMINAL_DEPOSIT_STATES } })
    .limit(DEPOSIT_SWEEPER_BATCH_SIZE);
  for (const authorization of terminal) {
    const state = authorization.state;
    const authorizationId = authorization._id as mongoose.Types.ObjectId;
    const key = "deposit-terminal-" + authorizationId.toString() + "-" + state;
    if (authorization.notificationKeys.includes(key)) continue;
    if (state === "ADMIN_APPROVED_CAPTURED" || state === "ADMIN_APPROVED_PARTIALLY_CAPTURED") {
      await recordCapturedSettlement(authorization, authorization.amountCaptured);
      await Booking.updateOne({ _id: authorization.bookingId }, { $set: { depositStatus: state === "ADMIN_APPROVED_CAPTURED" ? "deducted" : "partially_refunded" } });
    } else if (state !== "EXPIRED") {
      await Booking.updateOne({ _id: authorization.bookingId }, { $set: { depositStatus: "released", depositReleasedAt: new Date() } });
    }
    await notifyTerminalState(authorizationId, state);
  }
};

export const sweepSecurityDepositAuthorizations = async (now = new Date()) => {
  await reconcileDepositDecisions();
  await reconcileTerminalDepositSideEffects();
  let processed = 0;
  while (processed < DEPOSIT_SWEEPER_BATCH_SIZE) {
    const authorization = await claimNextAuthorization(now);
    if (!authorization) break;
    try {
      await executeProviderAction(authorization);
    } catch (error) {
      const delayMinutes = Math.min(60, 2 ** Math.min(authorization.attempts, 6));
      await SecurityDepositAuthorization.updateOne(
        { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
        { $set: { state: "FAILED_RETRYABLE", lastErrorCode: sanitizeProviderErrorCode(error), nextActionAt: new Date(Date.now() + delayMinutes * 60_000 + Math.floor(Math.random() * 30_000)) }, $unset: { leaseUntil: 1 }, $push: { audit: { event: "provider_action_failed", at: new Date(), fromState: authorization.state, toState: "FAILED_RETRYABLE" } } }
      );
    }
    processed += 1;
  }
  return processed;
};

export const reconcileDepositPaymentIntent = async (intent: Stripe.PaymentIntent) => {
  const authorization = await SecurityDepositAuthorization.findOne({ providerPaymentIntentId: intent.id });
  if (!authorization || TERMINAL_DEPOSIT_STATES.includes(authorization.state)) return authorization;
  if (intent.status === "canceled") {
    const expectedRelease = authorization.nextAction === "release";
    const state: SecurityDepositState = expectedRelease
      ? authorization.disputeId ? "ADMIN_REJECTED_RELEASED" : "RELEASED_NO_DISPUTE"
      : "EXPIRED";
    return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } }, { $set: { state, providerStatus: intent.status, amountCapturable: 0, nextAction: null }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { new: true });
  }
  if (intent.status === "succeeded" && authorization.nextAction === "capture") {
    const captured = Number(intent.amount_received || authorization.approvedAmount || 0);
    const state = resolveCaptureTerminalState(Math.min(captured, authorization.amountAuthorized), authorization.amountAuthorized);
    return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } }, { $set: { state, providerStatus: intent.status, amountCaptured: captured, amountCapturable: 0, nextAction: null }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { new: true });
  }
  if (["requires_payment_method", "payment_failed"].includes(intent.status)) {
    return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id }, { $set: { state: "PROVIDER_ACTION_REQUIRED", providerStatus: intent.status, lastErrorCode: "AUTHORIZATION_UNAVAILABLE", nextAction: null }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { new: true });
  }
  return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id }, { $set: { providerStatus: intent.status, amountCapturable: intent.amount_capturable } }, { new: true });
};
