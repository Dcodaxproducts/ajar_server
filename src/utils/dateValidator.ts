import { Booking } from "../models/booking.model";
import mongoose from "mongoose";

/**
 * Check if the new booking dates overlap with existing approved bookings.
 */
export const isBookingDateAvailable = async (
  listingId: mongoose.Types.ObjectId,
  newCheckIn: Date,
  newCheckOut: Date,
  excludeBookingId?: mongoose.Types.ObjectId
): Promise<boolean> => {
  const overlappingBooking = await Booking.findOne({
    marketplaceListingId: listingId,
    status: { $in: ["approved", "pending"] }, // consider these as active
    _id: { $ne: excludeBookingId },
    $or: [
      {
        "dates.checkIn": { $lte: newCheckOut },
        "dates.checkOut": { $gte: newCheckIn },
      },
    ],
  });

  return !overlappingBooking; // true if no overlap
};
