export const ACTIVE_BOOKING_STATUSES = ["approved", "in_progress"] as const;

export const bookingBlocksInventory = (
  status: string,
  hasHeldPayment: boolean
): boolean =>
  ACTIVE_BOOKING_STATUSES.includes(status as (typeof ACTIVE_BOOKING_STATUSES)[number]) ||
  (status === "pending" && hasHeldPayment);

export const availabilityCheckInForUnit = (
  checkIn: Date,
  priceUnit: string
): Date => priceUnit === "hour" ? new Date(checkIn.getTime() + 1) : checkIn;

export const dateRangesOverlap = (
  existingStart: Date,
  existingEnd: Date,
  requestedStart: Date,
  requestedEnd: Date
): boolean => existingStart <= requestedEnd && existingEnd >= requestedStart;

const utcDateKey = (date: Date): string => date.toISOString().slice(0, 10);

export const blackoutDatesOverlapRange = (
  blackoutDates: string[],
  requestedStart: Date,
  requestedEnd: Date
): boolean => {
  const start = utcDateKey(requestedStart);
  const end = utcDateKey(requestedEnd);
  return blackoutDates.some((date) => date >= start && date <= end);
};

export const parseBlackoutDates = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};
