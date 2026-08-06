import { Booking } from "../models/booking.model";
import { Zone } from "../models/zone.model";
import { Payment } from "../models/payment.model";
import { notificationQueue } from "../queues/notification.queue";
import { releaseBookingPaymentHold } from "./bookingStripePayments";

export const checkAndUpdateBookingExpiry = async (booking: any): Promise<any> => {
  if (booking.status !== "pending") return booking;

  // Expiry only exists to release a held payment the leaser never approved.
  // Unpaid bookings hold nothing — they stay pending and get cleaned up by
  // the unpaid booking cron instead.
  const hasPayment = await Payment.exists({ bookingId: booking._id });
  if (!hasPayment) return booking;

  const zone = await Zone.findById(booking?.marketplaceListingId?.zone?._id).lean();
  if (!zone?.bookingExpiryEnabled) return booking;

  const expiryMinutes = zone.expiryTimeMinutes ?? 15;
  const expiryTime = new Date(
    new Date(booking.createdAt).getTime() + expiryMinutes * 60_000
  );

  if (new Date() > expiryTime) {
    await releaseBookingPaymentHold(booking._id);
    await Booking.findByIdAndUpdate(booking._id, { status: "expired" });
    booking.status = "expired";

    // ✅ Notify the renter that their booking has expired
    try {
      const renterId = booking.renter?._id?.toString() ?? booking.renter?.toString();
      const leaserId = booking.leaser?._id?.toString() ?? booking.leaser?.toString();
      const listingName = booking.marketplaceListingId?.name ?? "your listing";
      const listingId = booking.marketplaceListingId?._id?.toString() ?? booking.marketplaceListingId?.toString();

      // Renter — they're waiting for approval
      await notificationQueue.add("booking-request-expired", {
        userId: renterId,
        title: "Booking Request Expired",
        message: `Your booking request for "${listingName}" has expired as it was not approved by the leaser in time.`,
        data: {
          bookingId: booking._id.toString(),
          listingId,
          type: "booking_expired",
        },
      });

      // Leaser — they failed to respond
      await notificationQueue.add("booking-request-expired", {
        userId: leaserId,
        title: "Booking Request Expired",
        message: `A booking request for "${listingName}" has expired because you did not approve or reject it in time.`,
        data: {
          bookingId: booking._id.toString(),
          listingId,
          type: "booking_expired",
        },
      });
    } catch (err) {
      console.error("Expiry notification failed:", err);
    }
  }

  return booking;
};
