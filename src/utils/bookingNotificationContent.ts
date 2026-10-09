import i18next from "i18next";
import { Booking } from "../models/booking.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { normalizeLocale } from "./locale";

export type NotificationPayload = Record<string, unknown>;

type BookingSnapshot = {
  _id: unknown;
  renter?: unknown;
  leaser?: unknown;
  marketplaceListingId?: unknown;
  dates?: { checkIn?: Date | string; checkOut?: Date | string };
  language?: string;
  otp?: string;
  returnOtp?: string;
};

type ListingSnapshot = {
  _id: unknown;
  name?: string;
  language?: string;
  languages?: Array<{ locale?: string; translations?: { name?: string } }>;
};

export type BookingNotificationContext = {
  eventType: string;
  locale?: string;
  itemName?: string;
  checkIn?: Date | string;
  checkOut?: Date | string;
  status?: string;
  pin?: string;
};

export type VisibleNotificationContent = {
  title: string;
  message: string;
  itemName: string;
  dateRange: string | null;
  locale: "en" | "ar";
};

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export const BOOKING_NOTIFICATION_EVENTS = new Set([
  "payment-held", "new-booking-request", "booking-request-expired",
  "extension-rejected", "extension-approved", "extension-payment-captured",
  "booking-approved", "booking-fee-received", "security-deposit-received",
  "booking-completed", "security-deposit-refunded", "security-deposit-released",
  "booking-status-changed", "booking-completed-deposit-held",
  "booking-cancelled-leaser", "booking-expired", "booking-deleted",
  "booking-deleted-admin", "booking-started", "return-pin", "return-confirmed",
  "refund-request-submitted", "new-refund-request", "refund-rejected",
  "refund-approved", "refund-processed", "damage-report-filed",
  "damage-report-filed-renter", "damage-report-approved",
  "damage-report-partially-approved", "damage-charges-deducted",
  "damage-report-rejected", "booking-approval-expiring", "booking-pickup",
  "booking-handover", "booking-review", "booking-inspect-item",
  "dispute-window-closing", "booking-return", "booking-return-leaser",
]);

const toId = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) return String(value);
  return "";
};

const safeItemName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && !OBJECT_ID_PATTERN.test(trimmed) ? trimmed : undefined;
};

const translatedListingName = (listing: ListingSnapshot | undefined, locale: string) => {
  const translated = listing?.languages?.find((entry) => normalizeLocale(entry.locale) === locale)
    ?.translations?.name;
  return safeItemName(translated) ?? safeItemName(listing?.name);
};

export const formatBookingDateRange = (
  checkIn: Date | string | undefined,
  checkOut: Date | string | undefined,
  locale: "en" | "ar"
): string | null => {
  if (!checkIn || !checkOut) return null;
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const formatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

const eventKey = (eventType: string, status?: string): string => {
  const aliases: Record<string, string> = {
    "damage-report-partially-approved": "damage-report-approved",
    "booking-approval-expiring": "booking_approval_expiring",
    "booking-pickup": "pickup_reminder",
    "booking-handover": "handover_reminder",
    "booking-review": "review_reminder",
    "booking-inspect-item": "returned_item_inspection",
    "dispute-window-closing": "dispute_window_closing",
    "booking-return": "return_reminder",
    "booking-return-leaser": "return_due",
  };
  if (eventType === "booking-status-changed") {
    const safeStatus = ["approved", "rejected", "request_cancelled", "booking_cancelled", "completed"]
      .includes(status ?? "") ? status : "updated";
    return `booking-status-changed.${safeStatus}`;
  }
  return aliases[eventType] ?? eventType;
};

export const buildBookingNotificationContent = (
  context: BookingNotificationContext
): VisibleNotificationContent => {
  const locale = normalizeLocale(context.locale) as "en" | "ar";
  const t = i18next.getFixedT(locale, "notification");
  const itemName = safeItemName(context.itemName) ?? t("booking.genericItem");
  const dateRange = formatBookingDateRange(context.checkIn, context.checkOut, locale);
  const key = eventKey(context.eventType, context.status);
  const variables = {
    itemName,
    dateRange: dateRange ?? t("booking.dateUnavailable"),
    pin: context.pin ?? "",
    pinText: context.pin ? t("booking.pinText", { pin: context.pin }) : "",
  };
  return {
    title: t(`booking.events.${key}.title`, variables),
    message: t(`booking.events.${key}.message`, variables),
    itemName,
    dateRange,
    locale,
  };
};

const bookingEventFromPayload = (eventType: string, data: NotificationPayload) =>
  BOOKING_NOTIFICATION_EVENTS.has(eventType) || data.type === "payment_held"
    ? (data.type === "payment_held" ? "payment-held" : eventType)
    : null;

const loadContext = async (userId: string, data: NotificationPayload) => {
  const bookingId = toId(data.bookingId);
  if (!bookingId) return { booking: undefined, listing: undefined };
  const booking = await Booking.findById(bookingId)
    .select("renter leaser marketplaceListingId dates language otp returnOtp")
    .lean<BookingSnapshot>();
  if (!booking) return { booking: undefined, listing: undefined };

  const isParty = [booking.renter, booking.leaser].some((id) => toId(id) === userId);
  if (!isParty) return { booking: undefined, listing: undefined };
  const listingId = toId(booking.marketplaceListingId) || toId(data.listingId);
  const listing = listingId
    ? await MarketplaceListing.findById(listingId)
      .select("name language languages")
      .lean<ListingSnapshot>()
    : undefined;
  return { booking, listing: listing ?? undefined };
};

export const prepareBookingNotification = async (
  eventType: string,
  userId: string,
  title: string,
  message: string,
  data: NotificationPayload = {}
) => {
  const canonicalEvent = bookingEventFromPayload(eventType, data);
  if (!canonicalEvent) return { title, message, data };
  const { booking, listing } = await loadContext(userId, data);
  if (!booking && data.eventType === canonicalEvent && typeof data.itemName === "string") {
    return { title, message, data };
  }
  const isRenter = booking ? toId(booking.renter) === userId : true;
  const locale = isRenter ? booking?.language : listing?.language ?? booking?.language;
  const pin = canonicalEvent === "return-pin" ? booking?.returnOtp
    : canonicalEvent === "booking-approved" ? booking?.otp : undefined;
  const content = buildBookingNotificationContent({
    eventType: canonicalEvent,
    locale,
    itemName: translatedListingName(listing, normalizeLocale(locale)),
    checkIn: booking?.dates?.checkIn,
    checkOut: booking?.dates?.checkOut,
    status: typeof data.status === "string" ? data.status : undefined,
    pin,
  });
  return {
    title: content.title,
    message: content.message,
    data: {
      ...data,
      eventType: canonicalEvent,
      itemName: content.itemName,
      dateRange: content.dateRange,
      locale: content.locale,
    },
  };
};

export const isLegacyPaymentHeldNotification = (value: {
  title?: unknown;
  data?: NotificationPayload;
}) => value.data?.type === "payment_held" || value.data?.eventType === "payment-held" ||
  value.title === "Payment Hold Confirmed";

export type NotificationHistoryItem = {
  _id?: unknown;
  user?: unknown;
  title?: unknown;
  message?: unknown;
  data?: NotificationPayload;
  [key: string]: unknown;
};

export const sanitizeNotificationHistory = async (
  notifications: NotificationHistoryItem[],
  userId: string
): Promise<NotificationHistoryItem[]> => {
  const targets = notifications.filter(isLegacyPaymentHeldNotification);
  if (!targets.length) return notifications;
  const bookingIds = [...new Set(targets.map((item) => toId(item.data?.bookingId)).filter(Boolean))];
  const bookings = bookingIds.length
    ? await Booking.find({ _id: { $in: bookingIds } })
      .select("renter leaser marketplaceListingId dates language")
      .lean<BookingSnapshot[]>()
    : [];
  const ownedBookings = bookings.filter((booking) => toId(booking.renter) === userId);
  const bookingMap = new Map(ownedBookings.map((booking) => [toId(booking._id), booking]));
  const listingIds = [...new Set(ownedBookings.map((booking) => toId(booking.marketplaceListingId)).filter(Boolean))];
  const listings = listingIds.length
    ? await MarketplaceListing.find({ _id: { $in: listingIds } })
      .select("name language languages")
      .lean<ListingSnapshot[]>()
    : [];
  const listingMap = new Map(listings.map((listing) => [toId(listing._id), listing]));

  return notifications.map((notification) => {
    if (!isLegacyPaymentHeldNotification(notification)) return notification;
    const booking = bookingMap.get(toId(notification.data?.bookingId));
    const listing = booking ? listingMap.get(toId(booking.marketplaceListingId)) : undefined;
    const locale = booking?.language ?? (typeof notification.data?.locale === "string"
      ? notification.data.locale : undefined);
    const content = buildBookingNotificationContent({
      eventType: "payment-held",
      locale,
      itemName: translatedListingName(listing, normalizeLocale(locale)),
      checkIn: booking?.dates?.checkIn,
      checkOut: booking?.dates?.checkOut,
    });
    return {
      ...notification,
      title: content.title,
      message: content.message,
      data: {
        ...notification.data,
        eventType: "payment-held",
        itemName: content.itemName,
        dateRange: content.dateRange,
        locale: content.locale,
      },
    };
  });
};
