import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model";
import { DamageReport } from "../models/damageReport.model";
import { Payment } from "../models/payment.model";
import { SecurityDepositAuthorization } from "../models/securityDepositAuthorization.model";
import { User } from "../models/user.model";
import { refundBookingSecurityDeposit } from "../utils/bookingStripePayments";
import { createTransaction } from "../utils/transactionLedger";

const LEGACY_RELEASE_LEASE_MS = 30 * 60 * 1000;
export const LEGACY_DEPOSIT_BATCH_SIZE = 25;

const availableReleaseStates = (clock: Date) => {
  const staleBefore = new Date(clock.getTime() - LEGACY_RELEASE_LEASE_MS);
  return [
    { depositStatus: "held", disputeWindowEndsAt: { $lte: clock } },
    {
      depositStatus: "release_pending",
      $or: [
        { depositReleaseLockedAt: { $exists: false } },
        { depositReleaseLockedAt: { $lte: staleBefore } },
      ],
    },
  ];
};

export const releaseExpiredLegacySecurityDeposits = async (clock = new Date()) => {
  const candidates = await Booking.find({
    securityDepositPaymentMode: { $ne: "separate_authorization" },
    status: { $in: ["completed", "booking_cancelled"] },
    "priceDetails.securityDeposit": { $gt: 0 },
    damageDisputeId: { $exists: false },
    $or: availableReleaseStates(clock),
  })
    .select("_id")
    .sort({ disputeWindowEndsAt: 1, _id: 1 })
    .limit(LEGACY_DEPOSIT_BATCH_SIZE)
    .lean();

  for (const candidate of candidates) {
    const lockToken = randomUUID();
    try {
      const booking = await Booking.findOneAndUpdate(
        {
          _id: candidate._id,
          securityDepositPaymentMode: { $ne: "separate_authorization" },
          status: { $in: ["completed", "booking_cancelled"] },
          "priceDetails.securityDeposit": { $gt: 0 },
          damageDisputeId: { $exists: false },
          $or: availableReleaseStates(clock),
        },
        {
          $set: {
            depositStatus: "release_pending",
            depositReleaseLockToken: lockToken,
            depositReleaseLockedAt: clock,
          },
        },
        { new: true }
      );
      if (!booking) continue;

      const depositAmount = Number(booking.priceDetails.securityDeposit || 0);
      await refundBookingSecurityDeposit(
        booking._id,
        depositAmount,
        undefined,
        "legacy-auto-window-expiry-v2"
      );
      const finalized = await Booking.updateOne(
        {
          _id: booking._id,
          depositStatus: "release_pending",
          depositReleaseLockToken: lockToken,
          damageDisputeId: { $exists: false },
        },
        {
          $set: { depositStatus: "released", depositReleasedAt: clock },
          $unset: { depositReleaseLockToken: 1, depositReleaseLockedAt: 1 },
        }
      );
      if (finalized.modifiedCount !== 1) {
        throw new Error("LEGACY_DEPOSIT_RELEASE_STATE_CHANGED");
      }
    } catch (error) {
      await Booking.updateOne(
        {
          _id: candidate._id,
          depositStatus: "release_pending",
          depositReleaseLockToken: lockToken,
        },
        { $unset: { depositReleaseLockToken: 1, depositReleaseLockedAt: 1 } }
      ).catch(() => undefined);
      console.error("Legacy security deposit release failed:", error);
    }
  }
  return candidates.length;
};

export const settleLegacyDamageDecision = async (
  reportId: mongoose.Types.ObjectId | string
) => {
  const report = await DamageReport.findById(reportId).lean();
  if (!report || !["approved", "rejected"].includes(report.status)) return null;
  const booking = await Booking.findOne({
    _id: report.booking,
    securityDepositPaymentMode: { $ne: "separate_authorization" },
    depositStatus: "disputed",
  }).lean();
  if (!booking) return null;
  if (await SecurityDepositAuthorization.exists({ bookingId: booking._id })) return null;

  const depositAmount = Number(booking.priceDetails.securityDeposit || 0);
  const approvedAmount = report.status === "approved"
    ? Number(report.approvedAmount || 0)
    : 0;
  const refundAmount = Number((depositAmount - approvedAmount).toFixed(2));
  if (refundAmount < 0) throw new Error("LEGACY_DEPOSIT_DECISION_AMOUNT_INVALID");

  if (refundAmount > 0) {
    await refundBookingSecurityDeposit(
      booking._id,
      refundAmount,
      undefined,
      "legacy-dispute-" + String(report._id) + "-v2"
    );
  }

  if (approvedAmount > 0) {
    const payment = await Payment.findOne({
      bookingId: booking._id,
      type: { $in: ["booking", "extension"] },
      paymentIntentId: { $exists: true, $ne: "" },
    });
    const admin = await User.findOne({ role: "admin" }).select("_id").lean();
    if (!payment || !booking.leaser || !admin) {
      throw new Error("LEGACY_DEPOSIT_LEDGER_SOURCE_MISSING");
    }
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: booking.leaser as mongoose.Types.ObjectId,
      amount: approvedAmount,
      type: "credit",
      source: "damage_charge",
    });
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: admin._id as mongoose.Types.ObjectId,
      amount: approvedAmount,
      type: "debit",
      source: "damage_charge",
    });
  }

  const finalStatus = approvedAmount <= 0
    ? "released"
    : refundAmount > 0
      ? "partially_refunded"
      : "deducted";
  await Booking.updateOne(
    { _id: booking._id, depositStatus: "disputed" },
    {
      $set: {
        depositStatus: finalStatus,
        depositReleasedAt: new Date(),
        damagesCharges: {
          damagedCharges: approvedAmount,
          totalPrice: approvedAmount,
        },
      },
    }
  );
  return finalStatus;
};

export const reconcileLegacyDamageDecisions = async () => {
  const bookings = await Booking.find({
    securityDepositPaymentMode: { $ne: "separate_authorization" },
    depositStatus: "disputed",
    damageDisputeId: { $exists: true },
  })
    .select("damageDisputeId")
    .sort({ updatedAt: 1, _id: 1 })
    .limit(LEGACY_DEPOSIT_BATCH_SIZE)
    .lean();
  let settled = 0;
  for (const booking of bookings) {
    if (
      booking.damageDisputeId &&
      await settleLegacyDamageDecision(booking.damageDisputeId)
    ) {
      settled += 1;
    }
  }
  return settled;
};
