import "dotenv/config";
import mongoose from "mongoose";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.join("=") || true];
}));
const apply = args.has("--apply");
const rollback = args.has("--rollback");
const migrationId = args.get("--migration-id");
if (apply === rollback) throw new Error("Choose exactly one of --apply or --rollback");
if (typeof migrationId !== "string" || !migrationId.trim()) {
  throw new Error("--migration-id=<unique-release-id> is required");
}
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

const collectionName = process.env.REFUND_POLICY_COLLECTION || "refundpolicies";
const backupCollectionName = "refund_policy_hour_migration_backups";
const writeLine = (message) => process.stdout.write(`${message}\n`);
const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function toHours(tier, policyId, index) {
  if (!("daysBeforeCheckIn" in tier)) return { ...tier };
  const days = tier.daysBeforeCheckIn;
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new Error(`Policy ${policyId} tier ${index} has invalid daysBeforeCheckIn`);
  }
  const converted = days * 24;
  if (!Number.isSafeInteger(converted)) {
    throw new Error(`Policy ${policyId} tier ${index} exceeds safe hour range`);
  }
  if (tier.hoursBeforeCheckIn !== undefined && tier.hoursBeforeCheckIn !== converted) {
    throw new Error(`Policy ${policyId} tier ${index} has conflicting day/hour thresholds`);
  }
  const { daysBeforeCheckIn: _legacyDays, ...canonical } = tier;
  return { ...canonical, hoursBeforeCheckIn: converted };
}

await mongoose.connect(process.env.MONGO_URI);
try {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection has no database");
  const policies = db.collection(collectionName);
  const backups = db.collection(backupCollectionName);
  await backups.createIndex({ migrationId: 1, policyId: 1 }, { unique: true });

  if (apply) {
    const legacy = await policies.find({ "tiers.daysBeforeCheckIn": { $exists: true } }).toArray();
    const plan = legacy.map((document) => ({
      document,
      afterTiers: (document.tiers || []).map((tier, index) => toHours(tier, document._id, index)),
    }));
    writeLine(`Preflight complete: ${plan.length} policies require conversion`);
    if (args.has("--dry-run")) process.exitCode = 0;
    else if (plan.length > 0) {
      await backups.bulkWrite(plan.map(({ document, afterTiers }) => ({
        updateOne: {
          filter: { migrationId, policyId: document._id },
          update: { $setOnInsert: { migrationId, policyId: document._id, before: document, afterTiers, createdAt: new Date() } },
          upsert: true,
        },
      })), { ordered: true });
      const result = await policies.bulkWrite(plan.map(({ document, afterTiers }) => ({
        updateOne: {
          filter: { _id: document._id, tiers: document.tiers },
          update: { $set: { tiers: afterTiers } },
        },
      })), { ordered: true });
      if (result.modifiedCount !== plan.length) {
        throw new Error("Concurrent policy edit detected; use the backup collection to inspect/rollback this migration ID");
      }
      writeLine(`Converted ${result.modifiedCount} policies; backups retained under ${migrationId}`);
    }
  } else {
    const snapshots = await backups.find({ migrationId }).toArray();
    if (snapshots.length === 0) throw new Error("No backups found for this migration ID");
    for (const snapshot of snapshots) {
      const current = await policies.findOne({ _id: snapshot.policyId });
      if (!current || !jsonEqual(current.tiers, snapshot.afterTiers)) {
        throw new Error(`Policy ${snapshot.policyId} changed after migration; rollback aborted without overwriting it`);
      }
    }
    const result = await policies.bulkWrite(snapshots.map((snapshot) => ({
      updateOne: {
        filter: { _id: snapshot.policyId, tiers: snapshot.afterTiers },
        update: { $set: { tiers: snapshot.before.tiers } },
      },
    })), { ordered: true });
    if (result.modifiedCount !== snapshots.length) throw new Error("Rollback did not restore every policy");
    writeLine(`Rolled back ${result.modifiedCount} policies from ${migrationId}`);
  }
} finally {
  await mongoose.disconnect();
}
