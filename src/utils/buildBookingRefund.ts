import mongoose from "mongoose";
import { Booking } from "../models/booking.model";
import { IRefundPolicy } from "../models/refundPolicy.model";
import {
  calculateRefund,
  calculateEarlyReturnRefund,
  RefundBasis,
  RefundResult,
} from "./calculateRefund";

export interface RefundLine {
  booking: mongoose.Types.ObjectId;
  isExtension: boolean;
  price: number;
  deductedAmount: number;
  refundAmount: number;
}

export interface BookingRefundSummary {
  basis: RefundBasis;
  isEarlyReturn: boolean;
  appliedTier: RefundResult["appliedTier"];
  reason: string;
  lines: RefundLine[];
  totalPrice: number;
  totalDeducted: number;
  totalRefund: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const priceOf = (booking: any) => Number(booking?.priceDetails?.price ?? 0);

/**
 * Works out what to refund for a cancelled booking.
 *
 * Pre-pickup cancellation behaves exactly as before: one booking, check-in tiers.
 * An early return also pulls in the extensions, because each extension is its
 * own booking with its own Stripe PaymentIntent and has to be refunded
 * separately. The tier is picked once from the effective end of the rental so
 * every line gets the same percentage.
 */
export const buildBookingRefund = async (
  parentBooking: any,
  policy: IRefundPolicy,
  now: Date = new Date()
): Promise<BookingRefundSummary> => {
  const isEarlyReturn = parentBooking.cancelledFromStatus === "in_progress";

  const children = isEarlyReturn
    ? await Booking.find({ previousBookingId: parentBooking._id }).lean()
    : [];

  const bookings = [parentBooking, ...children];

  // The renter is really asking "how early am I returning?", so the tier comes
  // from the last check-out across the parent and its extensions
  const effectiveCheckOut = bookings.reduce<Date>((latest, booking: any) => {
    const checkOut = new Date(booking?.dates?.checkOut);
    return checkOut > latest ? checkOut : latest;
  }, new Date(parentBooking?.dates?.checkOut));

  const checkIn = new Date(parentBooking?.dates?.checkIn);

  const priceFor = (booking: any): RefundResult =>
    isEarlyReturn
      ? calculateEarlyReturnRefund(priceOf(booking), effectiveCheckOut, policy, now)
      : calculateRefund(priceOf(booking), checkIn, policy, now);

  const lines: RefundLine[] = bookings.map((booking: any) => {
    const result = priceFor(booking);

    return {
      booking: booking._id,
      isExtension: Boolean(booking.previousBookingId),
      price: priceOf(booking),
      deductedAmount: result.deductedAmount,
      refundAmount: result.refundAmount,
    };
  });

  // Every line resolves to the same tier, so the parent's result describes them all
  const headline = priceFor(parentBooking);

  return {
    basis: headline.basis,
    isEarlyReturn,
    appliedTier: headline.appliedTier,
    reason: headline.reason,
    lines,
    totalPrice: round2(lines.reduce((sum, l) => sum + l.price, 0)),
    totalDeducted: round2(lines.reduce((sum, l) => sum + l.deductedAmount, 0)),
    totalRefund: round2(lines.reduce((sum, l) => sum + l.refundAmount, 0)),
  };
};
