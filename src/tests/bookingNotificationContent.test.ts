import assert from "node:assert/strict";
import test, { before } from "node:test";
import { initI18n } from "../config/i18n";
import {
  BOOKING_NOTIFICATION_EVENTS,
  buildBookingNotificationContent,
  isLegacyPaymentHeldNotification,
  sanitizeNotificationHistory,
} from "../utils/bookingNotificationContent";
import { Booking } from "../models/booking.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";

before(async () => {
  await initI18n();
});

const mongoId = "507f1f77bcf86cd799439011";
const dates = {
  checkIn: "2026-10-12T00:00:00.000Z",
  checkOut: "2026-10-15T00:00:00.000Z",
};

test("payment-held copy uses item details and localized booking dates without internal IDs", () => {
  const content = buildBookingNotificationContent({
    eventType: "payment-held",
    locale: "en",
    itemName: "Canon EOS R5",
    ...dates,
  });
  assert.match(content.message, /Canon EOS R5/);
  assert.match(content.message, /12 Oct 2026/);
  assert.doesNotMatch(content.title + content.message, /[a-f0-9]{24}/i);
});

test("Arabic recipient context produces Arabic copy, Arabic date formatting, and localized item name", () => {
  const content = buildBookingNotificationContent({
    eventType: "payment-held",
    locale: "ar",
    itemName: "كاميرا كانون",
    ...dates,
  });
  assert.equal(content.locale, "ar");
  assert.match(content.title + content.message, /[؀-ۿ]/);
  assert.match(content.message, /كاميرا كانون/);
  assert.match(content.dateRange ?? "", /أكتوبر/);
});

test("missing or unsafe listing context falls back to a localized generic booking phrase", () => {
  const en = buildBookingNotificationContent({
    eventType: "payment-held",
    locale: "en",
    itemName: mongoId,
  });
  const ar = buildBookingNotificationContent({
    eventType: "payment-held",
    locale: "ar",
  });
  assert.match(en.message, /your booking/);
  assert.match(ar.message, /حجزك/);
  assert.doesNotMatch(en.title + en.message + ar.title + ar.message, new RegExp(mongoId));
});

test("every audited booking/payment/refund/damage event template hides Mongo IDs", () => {
  for (const eventType of BOOKING_NOTIFICATION_EVENTS) {
    const content = buildBookingNotificationContent({
      eventType,
      locale: "en",
      itemName: mongoId,
      status: "rejected",
      ...dates,
    });
    assert.doesNotMatch(content.title + content.message, /[a-f0-9]{24}/i, eventType);
    assert.notEqual(content.title, `booking.events.${eventType}.title`, eventType);
  }
});

test("historical payment-held detection is explicit and does not rewrite arbitrary user content", () => {
  assert.equal(isLegacyPaymentHeldNotification({
    title: "Payment Hold Confirmed",
    data: { bookingId: mongoId, type: "payment_held" },
  }), true);
  assert.equal(isLegacyPaymentHeldNotification({
    title: `A user wrote ${mongoId}`,
    data: { type: "chat" },
  }), false);
});

test("historical payment-held rows are enriched in batches and retain internal navigation data", async () => {
  const originalBookingFind = Booking.find;
  const originalListingFind = MarketplaceListing.find;
  let bookingQueries = 0;
  let listingQueries = 0;
  const chain = <T>(value: T) => ({ select: () => ({ lean: async () => value }) });
  Booking.find = (() => {
    bookingQueries += 1;
    return chain([{
      _id: mongoId,
      renter: "user-1",
      leaser: "user-2",
      marketplaceListingId: "507f191e810c19729de860ea",
      language: "en",
      dates,
    }]);
  }) as unknown as typeof Booking.find;
  MarketplaceListing.find = (() => {
    listingQueries += 1;
    return chain([{
      _id: "507f191e810c19729de860ea",
      name: "Canon EOS R5",
      language: "en",
      languages: [],
    }]);
  }) as unknown as typeof MarketplaceListing.find;

  try {
    const rows = await sanitizeNotificationHistory([{
      title: "Payment Hold Confirmed",
      message: `Your payment for booking "${mongoId}" has been held successfully.`,
      data: { bookingId: mongoId, type: "payment_held" },
    }, {
      title: "Payment Hold Confirmed",
      message: `Your payment for booking "${mongoId}" has been held successfully.`,
      data: { bookingId: mongoId, type: "payment_held" },
    }], "user-1");
    assert.equal(bookingQueries, 1);
    assert.equal(listingQueries, 1);
    assert.equal(rows[0].data?.bookingId, mongoId);
    assert.match(String(rows[0].message), /Canon EOS R5/);
    assert.doesNotMatch(String(rows[0].message), new RegExp(mongoId));
  } finally {
    Booking.find = originalBookingFind;
    MarketplaceListing.find = originalListingFind;
  }
});

test("worker persists and pushes prepared structured copy while retaining bookingId navigation data", async () => {
  const fs = await import("node:fs/promises");
  const [worker, controller] = await Promise.all([
    fs.readFile("src/workers/notification.worker.ts", "utf8"),
    fs.readFile("src/controllers/notification.controller.ts", "utf8"),
  ]);
  assert.ok(worker.includes("prepareBookingNotification"));
  assert.ok(worker.includes("prepared.title"));
  assert.ok(worker.includes("prepared.message"));
  assert.ok(worker.includes("prepared.data"));
  assert.ok(controller.includes("sanitizeNotificationHistory(transformedData, userId)"));
  const formatter = await fs.readFile("src/utils/bookingNotificationContent.ts", "utf8");
  assert.ok(formatter.includes("...data"));
  assert.ok(formatter.includes("eventType: canonicalEvent"));
  assert.ok(formatter.includes("itemName: content.itemName"));
  assert.ok(formatter.includes("dateRange: content.dateRange"));
});
