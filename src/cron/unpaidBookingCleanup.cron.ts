import cron from "node-cron";
import { Booking } from "../models/booking.model";
import { Payment } from "../models/payment.model";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_DAY_AT_ONE_AM = "0 1 * * *";

let unpaidBookingCleanupCron: ReturnType<typeof cron.schedule> | null = null;

// Bookings the renter created but never paid for are hidden everywhere, so
// there is nothing to keep them around for after a day.
export const removeUnpaidBookings = async () => {
  const cutoff = new Date(Date.now() - DAY_MS);

  console.log("[UnpaidBookingCleanupCron] Started", new Date().toISOString());

  const candidates = await Booking.find({
    status: "pending",
    createdAt: { $lte: cutoff },
  })
    .select("_id")
    .lean();

  if (candidates.length === 0) {
    console.log("[UnpaidBookingCleanupCron] Nothing to clean");
    return;
  }

  const candidateIds = candidates.map((booking) => booking._id);

  // Any payment record at all means money was involved — leave those alone
  const paidBookingIds = await Payment.find({
    bookingId: { $in: candidateIds },
  }).distinct("bookingId");

  const paidSet = new Set(paidBookingIds.map((id: any) => id.toString()));
  const unpaidIds = candidateIds.filter((id: any) => !paidSet.has(id.toString()));

  if (unpaidIds.length === 0) {
    console.log("[UnpaidBookingCleanupCron] Nothing to clean");
    return;
  }

  const result = await Booking.deleteMany({ _id: { $in: unpaidIds } });

  console.log(
    `[UnpaidBookingCleanupCron] Removed ${result.deletedCount} unpaid bookings`
  );
};

export const startUnpaidBookingCleanupCron = () => {
  if (unpaidBookingCleanupCron) return unpaidBookingCleanupCron;

  console.log("[UnpaidBookingCleanupCron] Scheduling daily job");

  unpaidBookingCleanupCron = cron.schedule(EVERY_DAY_AT_ONE_AM, () => {
    removeUnpaidBookings().catch((error) => {
      console.error("[UnpaidBookingCleanupCron] Failed:", error);
    });
  });

  return unpaidBookingCleanupCron;
};
