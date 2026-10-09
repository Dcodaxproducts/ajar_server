import cron from "node-cron";
import { Booking } from "../models/booking.model";
import { refundBookingSecurityDeposit } from "../utils/bookingStripePayments";
import { notificationQueue } from "../queues/notification.queue";

const EVERY_FIFTEEN_MINUTES = "*/15 * * * *";
let securityDepositReleaseCron: ReturnType<typeof cron.schedule> | null = null;

export const releaseExpiredSecurityDeposits = async (clock = new Date()) => {
  const candidateIds = await Booking.find({
    status: { $in: ["completed", "booking_cancelled"] },
    "priceDetails.securityDeposit": { $gt: 0 },
    damageDisputeId: { $exists: false },
    $or: [
      { depositStatus: "held", disputeWindowEndsAt: { $lte: clock } },
      { depositStatus: "release_pending" },
    ],
  }).select("_id").limit(50).lean();

  for (const candidate of candidateIds) {
    try {
      // Persist the claim before Stripe. A restart can safely resume this state,
      // while dispute submission can no longer claim the same deposit.
      const claimedBooking = await Booking.findOneAndUpdate(
        {
          _id: candidate._id,
          status: { $in: ["completed", "booking_cancelled"] },
          "priceDetails.securityDeposit": { $gt: 0 },
          damageDisputeId: { $exists: false },
          $or: [
            { depositStatus: "held", disputeWindowEndsAt: { $lte: clock } },
            { depositStatus: "release_pending" },
          ],
        },
        { $set: { depositStatus: "release_pending" } },
        { new: true }
      )
        .populate("renter", "name email fcmToken")
        .populate("marketplaceListingId", "name title");
      if (!claimedBooking) continue;

      const depositAmount = Number(claimedBooking.priceDetails?.securityDeposit || 0);
      await refundBookingSecurityDeposit(
        claimedBooking._id,
        depositAmount,
        undefined,
        "auto-window-expiry-v1"
      );

      const finalized = await Booking.updateOne(
        { _id: claimedBooking._id, depositStatus: "release_pending", damageDisputeId: { $exists: false } },
        { $set: { depositStatus: "released", depositReleasedAt: clock } }
      );
      if (finalized.modifiedCount !== 1) {
        throw new Error("Deposit release state changed during settlement");
      }

      const renter = claimedBooking.renter as any;
      const renterId = renter?._id?.toString() || renter?.toString();
      const listing = claimedBooking.marketplaceListingId as any;
      const listingName = listing?.name || listing?.title || "your booking";
      if (renterId) {
        await notificationQueue.add("security-deposit-released", {
          userId: renterId,
          title: "Security Deposit Released",
          message: `Your security deposit of $${depositAmount.toFixed(2)} for "${listingName}" has been refunded after the damage dispute window expired.`,
          data: {
            bookingId: claimedBooking._id.toString(),
            type: "security_deposit",
            status: "released",
            refundedAmount: depositAmount.toFixed(2),
          },
        });
      }
    } catch (error) {
      // release_pending intentionally remains retryable after Stripe/network/DB
      // failures. Stripe idempotency prevents duplicate money movement.
      console.error("Security deposit auto-release failed:", error);
    }
  }
};

export const startSecurityDepositReleaseCron = () => {
  if (securityDepositReleaseCron) return securityDepositReleaseCron;
  releaseExpiredSecurityDeposits().catch((error) => {
    console.error("Initial security deposit release scan failed:", error);
  });
  securityDepositReleaseCron = cron.schedule(EVERY_FIFTEEN_MINUTES, () => {
    releaseExpiredSecurityDeposits().catch((error) => {
      console.error("Security deposit release cron failed:", error);
    });
  });
  return securityDepositReleaseCron;
};
