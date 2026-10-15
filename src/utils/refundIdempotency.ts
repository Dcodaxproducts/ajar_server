export const buildBookingRefundIdempotencyKey = (
  bookingId: string,
  settlementReference: string
): string =>
  ["booking-refund", bookingId, settlementReference].join("-").slice(0, 255);
