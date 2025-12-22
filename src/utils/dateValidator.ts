import { Booking } from "../models/booking.model";
import mongoose from "mongoose";

export const isBookingDateAvailable = async (
  listingId: mongoose.Types.ObjectId,
  newCheckIn: Date,
  newCheckOut: Date,
  excludeBookingId?: mongoose.Types.ObjectId
): Promise<boolean> => {
  const overlappingBooking = await Booking.findOne({
    marketplaceListingId: listingId,
    status: { $in: ["approved", "pending"] },
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
