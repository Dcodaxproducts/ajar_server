import { Booking } from "../models/booking.model";
import { Payment } from "../models/payment.model";
import mongoose from "mongoose";

export const isBookingDateAvailable = async (
  listingId: mongoose.Types.ObjectId,
  newCheckIn: Date,
  newCheckOut: Date,
  excludeBookingId?: mongoose.Types.ObjectId | mongoose.Types.ObjectId[]
): Promise<boolean> => {
  const excludeArray = excludeBookingId
    ? Array.isArray(excludeBookingId) ? excludeBookingId : [excludeBookingId]
    : [];

  const overlappingBookings = await Booking.find({
    marketplaceListingId: listingId,
    status: { $in: ["approved", "pending"] },
    ...(excludeArray.length > 0 && { _id: { $nin: excludeArray } }),
    $or: [
      {
        "dates.checkIn": { $lte: newCheckOut },
        "dates.checkOut": { $gte: newCheckIn },
      },
    ],
  }).select("_id status");

  if (!overlappingBookings.length) return true;

  const approvedOverlap = overlappingBookings.some((booking) => booking.status === "approved");
  if (approvedOverlap) return false;

  const pendingIds = overlappingBookings.map((booking) => booking._id);
  const heldPayment = await Payment.exists({
    bookingId: { $in: pendingIds },
    status: "held",
  });

  return !heldPayment;
};

export const isBookingExpiredForApproval = (
  booking: any,
  priceUnit: "hour" | "day" | "month" | "year"
): boolean => {
  const now = new Date();
  const checkOut = new Date(booking.dates.checkOut);

  switch (priceUnit) {
    case "hour":
      return now.getTime() > checkOut.getTime();

    case "day": {
      const endOfDay = new Date(checkOut);
      endOfDay.setUTCHours(23, 59, 59, 999);
      return now.getTime() > endOfDay.getTime();
    }

    case "month": {
      const endOfMonth = new Date(
        checkOut.getUTCFullYear(),
        checkOut.getUTCMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );
      return now.getTime() > endOfMonth.getTime();
    }

    case "year": {
      const endOfYear = new Date(
        checkOut.getUTCFullYear(),
        11,
        31,
        23,
        59,
        59,
        999
      );
      return now.getTime() > endOfYear.getTime();
    }

    default:
      return false;
  }
};
