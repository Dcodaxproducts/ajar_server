import "dotenv/config";
import mongoose from "mongoose";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.join("=") || true];
}));
const apply = args.has("--apply");
const rollback = args.has("--rollback");
const dryRun = args.has("--dry-run");
const migrationId = args.get("--migration-id");
if (apply === rollback) throw new Error("Choose exactly one of --apply or --rollback");
if (typeof migrationId !== "string" || !migrationId.trim()) {
  throw new Error("--migration-id=<unique-release-id> is required");
}
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

const writeLine = (message) => process.stdout.write(`${message}\n`);
const backupCollectionName = "damage_dispute_deposit_backups";
const DAY_MS = 24 * 60 * 60 * 1000;

function getWindowDays(booking) {
  const candidates = [
    booking.depositDisputeWindowDays,
    booking.rentalPolicySnapshot?.securityDepositRules?.disputeWindowDays,
  ];
  return candidates.find((value) => Number.isInteger(value) && value >= 0 && value <= 30);
}

function getActualReturnAt(booking) {
  return booking.bookingDates?.returnDate || booking.returnVerifiedAt || booking.dates?.checkOut;
}

await mongoose.connect(process.env.MONGO_URI);
try {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection has no database");
  const bookings = db.collection(process.env.BOOKING_COLLECTION || "bookings");
  const reports = db.collection(process.env.DAMAGE_REPORT_COLLECTION || "damagereports");
  const payments = db.collection(process.env.PAYMENT_COLLECTION || "payments");
  const backups = db.collection(backupCollectionName);
  if (!dryRun) {
    await backups.createIndex({ migrationId: 1, bookingId: 1 }, { unique: true });
  }

  if (apply) {
    const duplicateReports = await reports.aggregate([
      { $group: { _id: "$booking", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (duplicateReports.length > 0) {
      for (const duplicate of duplicateReports) {
        writeLine(`MANUAL_REVIEW ${JSON.stringify({
          bookingId: duplicate._id?.toString(),
          duplicateDisputes: duplicate.count,
        })}`);
      }
      throw new Error("Duplicate damage disputes must be resolved before creating the unique booking index");
    }
    if (!dryRun) {
      // Build the authoritative constraint before any booking becomes releasable.
      // This also closes the duplicate-insert race after the preflight above.
      await reports.createIndex({ booking: 1 }, { unique: true });
      writeLine("Verified unique damage-dispute index on booking");
    }

    const candidates = await bookings.find({
      status: { $in: ["completed", "booking_cancelled"] },
      "priceDetails.securityDeposit": { $gt: 0 },
      $or: [
        { disputeWindowEndsAt: { $exists: false } },
        { depositStatus: { $exists: false } },
      ],
    }).toArray();

    const plan = [];
    const manualReview = [];
    for (const booking of candidates) {
      const [payment, damageReports] = await Promise.all([
        payments.findOne({
          bookingId: booking._id,
          type: { $in: ["booking", "extension"] },
        }),
        reports.find({ booking: booking._id }).sort({ createdAt: 1 }).toArray(),
      ]);
      const windowDays = getWindowDays(booking);
      const returnedAt = getActualReturnAt(booking);
      const capturedPayment =
        payment && ["captured", "payout_pending", "paid_out"].includes(payment.status);
      const hasKnownRefund = !!(
        payment?.refundId ||
        payment?.depositRefundId ||
        payment?.refundedAt ||
        Number(payment?.depositRefundedAmount || 0) > 0 ||
        payment?.status === "partially_refunded" ||
        payment?.status === "refunded"
      );
      const existingState = booking.depositStatus;
      const unsafeExistingState =
        existingState !== undefined && !["held", "none"].includes(existingState);
      if (
        !capturedPayment ||
        hasKnownRefund ||
        windowDays === undefined ||
        !returnedAt ||
        damageReports.length > 0 ||
        unsafeExistingState
      ) {
        manualReview.push({
          bookingId: booking._id.toString(),
          missingCapturedPayment: !capturedPayment,
          knownPriorRefund: hasKnownRefund,
          missingWindowSnapshot: windowDays === undefined,
          missingReturnTimestamp: !returnedAt,
          existingDisputes: damageReports.length,
          unsafeExistingState: unsafeExistingState ? existingState : undefined,
        });
        continue;
      }
      const disputeWindowEndsAt = new Date(new Date(returnedAt).getTime() + windowDays * DAY_MS);
      const after = {};
      if (booking.depositDisputeWindowDays === undefined) {
        after.depositDisputeWindowDays = windowDays;
      }
      if (booking.disputeWindowEndsAt === undefined) {
        after.disputeWindowEndsAt = disputeWindowEndsAt;
      }
      if (booking.depositStatus === undefined) {
        after.depositStatus = "held";
      }
      if (Object.keys(after).length > 0) plan.push({ booking, after });
    }

    writeLine(`Preflight: ${plan.length} safe updates, ${manualReview.length} manual-review records`);
    for (const item of manualReview) writeLine(`MANUAL_REVIEW ${JSON.stringify(item)}`);
    if (!dryRun && plan.length > 0) {
      await backups.bulkWrite(plan.map(({ booking, after }) => ({
        updateOne: {
          filter: { migrationId, bookingId: booking._id },
          update: { $setOnInsert: { migrationId, bookingId: booking._id, before: booking, after, createdAt: new Date() } },
          upsert: true,
        },
      })), { ordered: true });
      const result = await bookings.bulkWrite(plan.map(({ booking, after }) => ({
        updateOne: {
          filter: {
            _id: booking._id,
            updatedAt: booking.updatedAt,
            $or: [
              { disputeWindowEndsAt: { $exists: false } },
              { depositStatus: { $exists: false } },
            ],
          },
          update: { $set: after },
        },
      })), { ordered: true });
      if (result.modifiedCount !== plan.length) {
        throw new Error("Concurrent booking edit detected; inspect backups and rollback this migration ID");
      }
      writeLine(`Updated ${result.modifiedCount} bookings; backups retained under ${migrationId}`);
    }
  } else {
    if (dryRun) throw new Error("--dry-run is only supported with --apply");
    const snapshots = await backups.find({ migrationId }).toArray();
    if (snapshots.length === 0) throw new Error("No backups found for this migration ID");
    for (const snapshot of snapshots) {
      const current = await bookings.findOne({ _id: snapshot.bookingId });
      for (const [key, expected] of Object.entries(snapshot.after)) {
        if (JSON.stringify(current?.[key]) !== JSON.stringify(expected)) {
          throw new Error(`Booking ${snapshot.bookingId} changed after migration; rollback aborted`);
        }
      }
    }
    for (const snapshot of snapshots) {
      const touchedKeys = Object.keys(snapshot.after);
      const restore = {};
      const remove = {};
      for (const key of touchedKeys) {
        if (Object.prototype.hasOwnProperty.call(snapshot.before, key)) {
          restore[key] = snapshot.before[key];
        } else {
          remove[key] = "";
        }
      }
      const update = {};
      if (Object.keys(restore).length > 0) update.$set = restore;
      if (Object.keys(remove).length > 0) update.$unset = remove;
      const result = await bookings.updateOne(
        { _id: snapshot.bookingId },
        update
      );
      if (result.matchedCount !== 1) {
        throw new Error(`Booking ${snapshot.bookingId} disappeared during rollback`);
      }
    }
    writeLine(`Rolled back ${snapshots.length} bookings from ${migrationId}`);
  }
} finally {
  await mongoose.disconnect();
}
