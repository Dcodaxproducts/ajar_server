export const ACTIVE_BOOKING_STATUSES = ["approved", "in_progress"] as const;

export const bookingBlocksInventory = (
  status: string,
  hasHeldPayment: boolean
): boolean =>
  ACTIVE_BOOKING_STATUSES.includes(status as (typeof ACTIVE_BOOKING_STATUSES)[number]) ||
  (status === "pending" && hasHeldPayment);

export const dateRangesOverlap = (
  existingStart: Date,
  existingEnd: Date,
  requestedStart: Date,
  requestedEnd: Date,
  endExclusive = false
): boolean => endExclusive
  ? existingStart < requestedEnd && existingEnd > requestedStart
  : existingStart <= requestedEnd && existingEnd >= requestedStart;

const utcDateKey = (date: Date): string => date.toISOString().slice(0, 10);

export const blackoutDatesOverlapRange = (
  blackoutDates: string[],
  requestedStart: Date,
  requestedEnd: Date,
  endExclusive = false
): boolean => {
  const start = utcDateKey(requestedStart);
  const effectiveEnd = endExclusive && requestedEnd > requestedStart
    ? new Date(requestedEnd.getTime() - 1)
    : requestedEnd;
  const end = utcDateKey(effectiveEnd);
  return blackoutDates.some((date) => date >= start && date <= end);
};

const normalizeBlackoutDateKeys = (items: unknown[]): string[] =>
  items.flatMap((item) => {
    if (typeof item !== "string") return [];
    const match = item.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
    return match ? [match[1]] : [];
  });

export const parseBlackoutDates = (value: unknown): string[] => {
  if (Array.isArray(value)) return normalizeBlackoutDateKeys(value);
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeBlackoutDateKeys(parsed) : [];
  } catch {
    return [];
  }
};
