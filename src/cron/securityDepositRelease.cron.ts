import cron from "node-cron";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model";
import { refundBookingSecurityDeposit } from "../utils/bookingStripePayments";
import { notificationQueue } from "../queues/notification.queue";

const EVERY_DAY_AT_MIDNIGHT = "0 0 * * *";

let securityDepositReleaseCron: ReturnType<typeof cron.schedule> | null = null;

export const releaseExpiredSecurityDeposits = async () => {
  const now = new Date();

  const bookings = await Booking.find({
    status: "completed",
    depositStatus: "held",
    disputeWindowEndsAt: { $lte: now },
    "priceDetails.securityDeposit": { $gt: 0 },
    damageDisputeId: { $exists: false },
  })
    .populate("renter", "name email fcmToken")
    .populate("marketplaceListingId", "name title")
    .limit(50);

  for (const booking of bookings) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const depositAmount = Number(booking.priceDetails?.securityDeposit || 0);
      if (depositAmount <= 0) {
        await session.abortTransaction();
        session.endSession();
        continue;
      }

      await refundBookingSecurityDeposit(booking._id, depositAmount, session);

      await Booking.findByIdAndUpdate(
        booking._id,
        {
          $set: {
            depositStatus: "released",
            depositReleasedAt: now,
          },
        },
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      try {
        const renter = booking.renter as any;
        const renterId = renter?._id?.toString() || renter?.toString();
        const listing = booking.marketplaceListingId as any;
        const listingName = listing?.name || listing?.title || "your booking";

        if (renterId) {
          await notificationQueue.add("security-deposit-released", {
            userId: renterId,
            title: "Security Deposit Released",
            message: `Your security deposit of $${depositAmount.toFixed(2)} for "${listingName}" has been released after the damage dispute window expired.`,
            data: {
              bookingId: booking._id.toString(),
              type: "security_deposit",
              status: "released",
              refundedAmount: depositAmount.toFixed(2),
            },
          });
        }
      } catch (notificationError) {
        console.error("Security deposit release notification failed:", notificationError);
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Security deposit auto-release failed:", error);
    }
  }
};

export const startSecurityDepositReleaseCron = () => {
  if (securityDepositReleaseCron) return securityDepositReleaseCron;

  if (process.env.NODE_ENV === "production") {
    releaseExpiredSecurityDeposits().catch((error) => {
      console.error("Initial security deposit release cron failed:", error);
    });
  }

  securityDepositReleaseCron = cron.schedule(EVERY_DAY_AT_MIDNIGHT, () => {
    releaseExpiredSecurityDeposits().catch((error) => {
      console.error("Security deposit release cron failed:", error);
    });
  });

  return securityDepositReleaseCron;
};
