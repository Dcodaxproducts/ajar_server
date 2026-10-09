import { Booking } from "../models/booking.model";
import { Payment } from "../models/payment.model";
import mongoose from "mongoose";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { ACTIVE_BOOKING_STATUSES, blackoutDatesOverlapRange, parseBlackoutDates } from "./bookingAvailability";

export const isBookingDateAvailable = async (
  listingId: mongoose.Types.ObjectId,
  newCheckIn: Date,
  newCheckOut: Date,
  excludeBookingId?: mongoose.Types.ObjectId | mongoose.Types.ObjectId[],
  session?: mongoose.ClientSession
): Promise<boolean> => {
  const excludeArray = excludeBookingId
    ? Array.isArray(excludeBookingId) ? excludeBookingId : [excludeBookingId]
    : [];

  const listing = await MarketplaceListing.findById(listingId)
    .select("unavailability")
    .session(session || null)
    .lean();
  if (!listing) return false;
  if (
    blackoutDatesOverlapRange(
      parseBlackoutDates(listing.unavailability),
      newCheckIn,
      newCheckOut
    )
  ) return false;

  const overlappingBookings = await Booking.find({
    marketplaceListingId: listingId,
    status: { $in: [...ACTIVE_BOOKING_STATUSES, "pending"] },
    ...(excludeArray.length > 0 && { _id: { $nin: excludeArray } }),
    $or: [
      {
        "dates.checkIn": { $lte: newCheckOut },
        "dates.checkOut": { $gte: newCheckIn },
      },
    ],
  }).select("_id status").session(session || null);

  if (!overlappingBookings.length) return true;

  const activeOverlap = overlappingBookings.some((booking) =>
    ACTIVE_BOOKING_STATUSES.includes(booking.status as (typeof ACTIVE_BOOKING_STATUSES)[number])
  );
  if (activeOverlap) return false;

  const pendingIds = overlappingBookings.map((booking) => booking._id);
  const heldPayment = await Payment.exists({
    bookingId: { $in: pendingIds },
    status: "held",
  }).session(session || null);

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

// MongoDB has no exclusion constraint for overlapping ranges. Every transition
// that starts reserving inventory writes this listing document in a transaction,
// serializing competing holds/approvals before the authoritative overlap query.
export const lockAndCheckBookingAvailability = async (
  listingId: mongoose.Types.ObjectId,
  checkIn: Date,
  checkOut: Date,
  excludeBookingId: mongoose.Types.ObjectId | mongoose.Types.ObjectId[],
  session: mongoose.ClientSession
): Promise<boolean> => {
  const locked = await MarketplaceListing.findOneAndUpdate(
    { _id: listingId },
    { $inc: { availabilityVersion: 1 } },
    { new: true, session }
  ).select("_id");
  if (!locked) return false;
  return isBookingDateAvailable(listingId, checkIn, checkOut, excludeBookingId, session);
};
