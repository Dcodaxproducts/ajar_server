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
  resolveDepositFundingMode,
  resolveFallbackRefundAmount,
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

export const registerSecurityDepositAuthorization = async (
  intent: Stripe.PaymentIntent,
  session?: mongoose.ClientSession
) => {
  const bookingId = intent.metadata?.bookingId;
  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId) || intent.metadata?.paymentPurpose !== "security_deposit") {
    throw new Error("DEPOSIT_METADATA_INVALID");
  }

  const booking = await Booking.findById(bookingId).session(session || null);
  if (!booking) throw new Error("DEPOSIT_BOOKING_NOT_FOUND");
  const amount = Math.round(Number(booking.priceDetails.securityDeposit || 0) * 100);
  if (amount <= 0 || intent.currency.toLowerCase() !== "usd") {
    throw new Error("DEPOSIT_AUTHORIZATION_CURRENCY_MISMATCH");
  }

  const existing = await SecurityDepositAuthorization.findOne({
    bookingId: booking._id,
  }).session(session || null);
  if (existing) {
    if (
      existing.providerPaymentIntentId !== intent.id ||
      existing.amountAuthorized !== amount ||
      existing.currency !== "usd"
    ) {
      throw new Error("DEPOSIT_AUTHORIZATION_IDEMPOTENCY_CONFLICT");
    }
    return existing;
  }

  const keys = depositActionKeys(bookingId);
  let providerIntent = await stripe.paymentIntents.retrieve(intent.id, {
    expand: ["latest_charge"],
  });
  const captureBefore = extractCaptureBefore(providerIntent);
  const deadline = calculateDamageDisputeDeadline(
    booking.dates.checkOut,
    resolveDamageDisputeWindow(booking)
  );
  const fundingMode = resolveDepositFundingMode(
    providerIntent.status,
    captureBefore,
    deadline
  );
  const authorizationSupported = fundingMode === "authorization_hold";

  if (!authorizationSupported && providerIntent.status === "requires_capture") {
    if (providerIntent.amount_capturable !== amount) {
      throw new Error("DEPOSIT_AUTHORIZATION_AMOUNT_MISMATCH");
    }
    providerIntent = await stripe.paymentIntents.capture(
      providerIntent.id,
      { metadata: { ...providerIntent.metadata, depositFundingMode: "captured_refundable" } },
      { idempotencyKey: keys.fallbackCapture }
    );
  }

  const capturedFallback = !authorizationSupported && providerIntent.status === "succeeded";
  if (!authorizationSupported && !capturedFallback) {
    throw Object.assign(new Error("DEPOSIT_FALLBACK_CAPTURE_NOT_CONFIRMED"), {
      code: "deposit_fallback_capture_not_confirmed",
    });
  }
  if (capturedFallback && Number(providerIntent.amount_received || 0) < amount) {
    throw new Error("DEPOSIT_FALLBACK_CAPTURE_AMOUNT_MISMATCH");
  }

  const state: SecurityDepositState = authorizationSupported
    ? "AUTHORIZED_HELD"
    : "CAPTURED_REFUNDABLE";
  const now = new Date();

  return SecurityDepositAuthorization.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $setOnInsert: {
        bookingId: booking._id,
        renterId: renterId(booking.renter),
        provider: "stripe",
        providerPaymentIntentId: providerIntent.id,
        amountAuthorized: amount,
        currency: "usd",
        releaseIdempotencyKey: keys.release,
        captureIdempotencyKey: keys.capture,
        fallbackCaptureIdempotencyKey: keys.fallbackCapture,
        refundIdempotencyKey: keys.refund,
        notificationKeys: [],
        attempts: 0,
        version: 0,
      },
      $set: {
        amountCapturable: authorizationSupported ? providerIntent.amount_capturable : 0,
        amountCaptured: capturedFallback ? amount : 0,
        amountRefunded: 0,
        providerStatus: providerIntent.status,
        captureBefore: captureBefore || now,
        disputeDeadline: deadline,
        state,
        fundingMode,
        fallbackReason: capturedFallback ? "AUTHORIZATION_WINDOW_UNSUPPORTED" : undefined,
        fallbackCapturedAt: capturedFallback ? now : undefined,
        nextAction: null,
        nextActionAt: deadline,
        lastErrorCode: undefined,
      },
      $push: {
        audit: {
          event: capturedFallback ? "fallback_capture_confirmed" : "authorization_confirmed",
          at: now,
          toState: state,
          amount: capturedFallback ? amount : undefined,
          idempotencyKey: capturedFallback ? keys.fallbackCapture : undefined,
        },
      },
    },
    { upsert: true, new: true, runValidators: true, session }
  );
};

export const scheduleSecurityDepositRelease = async (bookingId: mongoose.Types.ObjectId | string, returnedAt: Date, session?: mongoose.ClientSession) => {
  const booking = await Booking.findById(bookingId).session(session || null);
  if (!booking) throw new Error("DEPOSIT_BOOKING_NOT_FOUND");
  const authorization = await SecurityDepositAuthorization.findOne({ bookingId }).session(session || null);
  // Legacy bookings intentionally have no separate authorization record and
  // remain owned by the combined-payment settlement path.
  if (!authorization) return null;
  const deadline = calculateDamageDisputeDeadline(returnedAt, resolveDamageDisputeWindow(booking));
  const capturedFallback = authorization.fundingMode === "captured_refundable";
  const supported = capturedFallback || supportsDisputeDeadline(deadline, authorization.captureBefore);
  const state: SecurityDepositState = supported ? "RELEASE_SCHEDULED" : "PROVIDER_ACTION_REQUIRED";
  return SecurityDepositAuthorization.findOneAndUpdate(
    { _id: authorization._id, state: { $in: ["AUTHORIZED_HELD", "CAPTURED_REFUNDABLE", "RELEASE_SCHEDULED", "PROVIDER_ACTION_REQUIRED"] } },
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
  { bookingId, state: { $in: ["AUTHORIZED_HELD", "CAPTURED_REFUNDABLE", "RELEASE_SCHEDULED", "PROVIDER_ACTION_REQUIRED"] } },
  {
    $set: { state: "RELEASE_SCHEDULED", nextAction: "release", nextActionAt: new Date() },
    $unset: { leaseUntil: 1, lastErrorCode: 1 },
    $inc: { version: 1 },
    $push: { audit: { event: "booking_cancelled", at: new Date(), toState: "RELEASE_SCHEDULED" } },
  },
  { new: true, session }
);

export const blockDepositReleaseForDispute = async (bookingId: mongoose.Types.ObjectId | string, disputeId: mongoose.Types.ObjectId, checkedAt: Date, session: mongoose.ClientSession) => {
  const existing = await SecurityDepositAuthorization.findOne({ bookingId })
    .select("_id")
    .session(session);
  if (!existing) return null;
  const authorization = await SecurityDepositAuthorization.findOneAndUpdate(
    { bookingId, state: { $in: ["AUTHORIZED_HELD", "CAPTURED_REFUNDABLE", "RELEASE_SCHEDULED"] }, disputeDeadline: { $gt: checkedAt } },
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
  if (TERMINAL_DEPOSIT_STATES.includes(authorization.state)) return authorization;
  if (authorization.state !== "DISPUTE_OPEN") return authorization;
  if (report.status === "approved" && report.currency.toLowerCase() !== authorization.currency.toLowerCase()) {
    return SecurityDepositAuthorization.findOneAndUpdate(
      { _id: authorization._id, state: "DISPUTE_OPEN" },
      { $set: { state: "PROVIDER_ACTION_REQUIRED", nextAction: null, lastErrorCode: "DEPOSIT_DECISION_CURRENCY_MISMATCH" }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } },
      { new: true }
    );
  }
  const nextAction = report.status === "approved" ? "capture" : "release";
  return SecurityDepositAuthorization.findOneAndUpdate(
    { bookingId: report.booking, state: "DISPUTE_OPEN" },
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
  let payment;
  try {
    payment = await Payment.findOneAndUpdate(
      { paymentIntentId: authorization.providerPaymentIntentId },
      {
        $setOnInsert: {
          bookingId: authorization.bookingId,
          userId: authorization.renterId,
          amount: amount / 100,
          currency: authorization.currency,
          type: "damage",
          status: "captured",
          paymentIntentId: authorization.providerPaymentIntentId,
          capturedAt: new Date(),
          method: "stripe",
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    payment = await Payment.findOne({
      paymentIntentId: authorization.providerPaymentIntentId,
    });
    if (!payment) throw error;
    if (
      payment.bookingId.toString() !== authorization.bookingId.toString() ||
      payment.amount !== amount / 100
    ) {
      throw new Error("PAYMENT_INTENT_IDEMPOTENCY_CONFLICT");
    }
  }
  const leaser = booking.leaser as mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId };
  const leaserId = leaser instanceof mongoose.Types.ObjectId ? leaser : leaser._id;
  if (!leaserId) throw new Error("DEPOSIT_LEASER_NOT_FOUND");
  await createTransaction({ paymentId: payment._id as mongoose.Types.ObjectId, userId: leaserId, amount: amount / 100, type: "credit", source: "damage_charge" });
};

const refundedAmountFromIntent = (intent: Stripe.PaymentIntent): number => {
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  return Number(charge?.amount_refunded || 0);
};

const refundCapturedDeposit = async (
  authorization: InstanceType<typeof SecurityDepositAuthorization>,
  intent: Stripe.PaymentIntent,
  targetRefundAmount: number
) => {
  const alreadyRefunded = refundedAmountFromIntent(intent);
  if (alreadyRefunded >= targetRefundAmount) {
    return { amountRefunded: alreadyRefunded, refundId: authorization.providerRefundId };
  }
  if (alreadyRefunded > 0) {
    throw Object.assign(new Error("DEPOSIT_REFUND_AMOUNT_CONFLICT"), {
      code: "refund_amount_conflict",
    });
  }
  const refund = await stripe.refunds.create(
    {
      payment_intent: intent.id,
      amount: targetRefundAmount,
      metadata: {
        bookingId: String(authorization.bookingId),
        disputeId: String(authorization.disputeId || ""),
        paymentPurpose: "security_deposit_refund",
      },
    },
    { idempotencyKey: authorization.refundIdempotencyKey }
  );
  if (refund.status !== "succeeded") {
    throw Object.assign(new Error("DEPOSIT_REFUND_NOT_CONFIRMED"), {
      code: "refund_not_confirmed",
    });
  }
  return { amountRefunded: targetRefundAmount, refundId: refund.id };
};

const executeProviderAction = async (
  authorization: InstanceType<typeof SecurityDepositAuthorization>
) => {
  let intent = await stripe.paymentIntents.retrieve(
    authorization.providerPaymentIntentId,
    { expand: ["latest_charge"] }
  );
  const capturedFallback = authorization.fundingMode === "captured_refundable";

  if (authorization.nextAction === "release") {
    let amountRefunded = authorization.amountRefunded;
    let providerRefundId = authorization.providerRefundId;
    if (capturedFallback) {
      if (intent.status !== "succeeded") {
        throw Object.assign(new Error("DEPOSIT_REFUND_SOURCE_NOT_CAPTURED"), {
          code: "refund_source_not_captured",
        });
      }
      const refundResult = await refundCapturedDeposit(
        authorization,
        intent,
        resolveFallbackRefundAmount(null, authorization.amountAuthorized)
      );
      amountRefunded = refundResult.amountRefunded;
      providerRefundId = refundResult.refundId;
    } else {
      if (intent.status === "requires_capture") {
        intent = await stripe.paymentIntents.cancel(
          intent.id,
          {},
          { idempotencyKey: authorization.releaseIdempotencyKey }
        );
      }
      if (intent.status !== "canceled") {
        throw Object.assign(new Error("DEPOSIT_RELEASE_NOT_CONFIRMED"), {
          code: "release_not_confirmed",
        });
      }
    }

    const state: SecurityDepositState = authorization.disputeId
      ? "ADMIN_REJECTED_RELEASED"
      : "RELEASED_NO_DISPUTE";
    const result = await SecurityDepositAuthorization.updateOne(
      { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
      {
        $set: {
          state,
          providerStatus: intent.status,
          amountCapturable: 0,
          amountRefunded,
          providerRefundId,
          refundedAt: capturedFallback ? new Date() : undefined,
          nextAction: null,
        },
        $unset: { leaseUntil: 1, lastErrorCode: 1 },
        $inc: { version: 1 },
        $push: {
          audit: {
            event: capturedFallback ? "provider_refund_confirmed" : "provider_release_confirmed",
            at: new Date(),
            fromState: authorization.state,
            toState: state,
            amount: capturedFallback ? amountRefunded : undefined,
            idempotencyKey: capturedFallback
              ? authorization.refundIdempotencyKey
              : authorization.releaseIdempotencyKey,
          },
        },
      }
    );
    if (result.modifiedCount === 1) {
      await Booking.updateOne(
        { _id: authorization.bookingId },
        { $set: { depositStatus: "released", depositReleasedAt: new Date() } }
      );
      await notifyTerminalState(authorization._id as mongoose.Types.ObjectId, state);
    }
    return;
  }

  const amount = Number(authorization.approvedAmount || 0);
  if (amount <= 0 || amount > authorization.amountAuthorized) {
    throw Object.assign(new Error("DEPOSIT_CAPTURE_AMOUNT_INVALID"), {
      code: "capture_amount_invalid",
    });
  }

  let amountRefunded = authorization.amountRefunded;
  let providerRefundId = authorization.providerRefundId;
  if (capturedFallback) {
    if (intent.status !== "succeeded" || Number(intent.amount_received || 0) < authorization.amountAuthorized) {
      throw Object.assign(new Error("DEPOSIT_FALLBACK_CAPTURE_NOT_CONFIRMED"), {
        code: "fallback_capture_not_confirmed",
      });
    }
    const refundRemainder = resolveFallbackRefundAmount(
      amount,
      authorization.amountAuthorized
    );
    if (refundRemainder > 0) {
      const refundResult = await refundCapturedDeposit(
        authorization,
        intent,
        refundRemainder
      );
      amountRefunded = refundResult.amountRefunded;
      providerRefundId = refundResult.refundId;
    }
  } else {
    if (intent.status === "requires_capture") {
      if (amount > intent.amount_capturable) {
        throw Object.assign(new Error("DEPOSIT_CAPTURE_AMOUNT_INVALID"), {
          code: "capture_amount_invalid",
        });
      }
      intent = await stripe.paymentIntents.capture(
        intent.id,
        {
          amount_to_capture: amount,
          metadata: { disputeId: String(authorization.disputeId || "") },
        },
        { idempotencyKey: authorization.captureIdempotencyKey }
      );
    }
    if (intent.status !== "succeeded" || Number(intent.amount_received || 0) < amount) {
      throw Object.assign(new Error("DEPOSIT_CAPTURE_NOT_CONFIRMED"), {
        code: "capture_not_confirmed",
      });
    }
  }

  const state = resolveCaptureTerminalState(amount, authorization.amountAuthorized);
  await recordCapturedSettlement(authorization, amount);
  const result = await SecurityDepositAuthorization.updateOne(
    { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
    {
      $set: {
        state,
        providerStatus: intent.status,
        amountCaptured: capturedFallback ? authorization.amountAuthorized : amount,
        amountCapturable: 0,
        amountRefunded,
        providerRefundId,
        refundedAt: amountRefunded > 0 ? new Date() : undefined,
        nextAction: null,
      },
      $unset: { leaseUntil: 1, lastErrorCode: 1 },
      $inc: { version: 1 },
      $push: {
        audit: {
          event: capturedFallback
            ? "fallback_settlement_confirmed"
            : "provider_capture_confirmed",
          at: new Date(),
          fromState: authorization.state,
          toState: state,
          amount,
          idempotencyKey: capturedFallback
            ? authorization.refundIdempotencyKey
            : authorization.captureIdempotencyKey,
        },
      },
    }
  );
  if (result.modifiedCount === 1) {
    await Booking.updateOne(
      { _id: authorization.bookingId },
      {
        $set: {
          depositStatus: amount === authorization.amountAuthorized
            ? "deducted"
            : "partially_refunded",
        },
      }
    );
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
      await recordCapturedSettlement(
        authorization,
        Number(authorization.approvedAmount || authorization.amountCaptured)
      );
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
  if (
    intent.status === "succeeded" &&
    authorization.nextAction === "capture" &&
    authorization.fundingMode === "authorization_hold"
  ) {
    const captured = Number(intent.amount_received || authorization.approvedAmount || 0);
    const state = resolveCaptureTerminalState(Math.min(captured, authorization.amountAuthorized), authorization.amountAuthorized);
    return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } }, { $set: { state, providerStatus: intent.status, amountCaptured: captured, amountCapturable: 0, nextAction: null }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { new: true });
  }
  if (["requires_payment_method", "payment_failed"].includes(intent.status)) {
    return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id }, { $set: { state: "PROVIDER_ACTION_REQUIRED", providerStatus: intent.status, lastErrorCode: "AUTHORIZATION_UNAVAILABLE", nextAction: null }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { new: true });
  }
  return SecurityDepositAuthorization.findOneAndUpdate({ _id: authorization._id }, { $set: { providerStatus: intent.status, amountCapturable: intent.amount_capturable } }, { new: true });
};

export const reconcileDepositRefund = async (refund: Stripe.Refund) => {
  const paymentIntentId = typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id;
  if (!paymentIntentId) return null;
  const authorization = await SecurityDepositAuthorization.findOne({
    providerPaymentIntentId: paymentIntentId,
  });
  if (!authorization || TERMINAL_DEPOSIT_STATES.includes(authorization.state)) {
    return authorization;
  }

  if (refund.status === "succeeded") {
    return SecurityDepositAuthorization.findOneAndUpdate(
      { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
      {
        $set: {
          providerRefundId: refund.id,
          refundedAt: new Date(),
          nextActionAt: new Date(),
        },
        $max: { amountRefunded: refund.amount },
      },
      { new: true }
    );
  }

  if (refund.status === "failed" || refund.status === "canceled") {
    return SecurityDepositAuthorization.findOneAndUpdate(
      { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
      {
        $set: {
          state: "FAILED_RETRYABLE",
          providerRefundId: refund.id,
          lastErrorCode: "refund_" + refund.status,
          nextActionAt: new Date(),
        },
        $unset: { leaseUntil: 1 },
        $inc: { version: 1 },
      },
      { new: true }
    );
  }

  return SecurityDepositAuthorization.findOneAndUpdate(
    { _id: authorization._id, state: { $nin: TERMINAL_DEPOSIT_STATES } },
    {
      $set: {
        providerRefundId: refund.id,
        lastErrorCode: "refund_pending",
        nextActionAt: new Date(Date.now() + 5 * 60_000),
      },
      $unset: { leaseUntil: 1 },
    },
    { new: true }
  );
};
