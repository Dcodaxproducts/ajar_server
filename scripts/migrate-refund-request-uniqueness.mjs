import "dotenv/config";
import mongoose from "mongoose";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const rollback = args.has("--rollback");
const dryRun = args.has("--dry-run");
if (apply === rollback) throw new Error("Choose exactly one of --apply or --rollback");
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
const collectionName = process.env.REFUND_REQUEST_COLLECTION || "refundrequests";
const indexName = "uniq_refund_request_booking";

await mongoose.connect(process.env.MONGO_URI);
try {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection has no database");
  const collection = db.collection(collectionName);
  if (rollback) {
    if (dryRun) process.stdout.write("Would drop " + indexName + "\n");
    else { await collection.dropIndex(indexName); process.stdout.write("Dropped " + indexName + "\n"); }
  } else {
    const duplicates = await collection.aggregate([
      { $group: { _id: "$booking", count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
      { $limit: 100 },
    ]).toArray();
    if (duplicates.length) {
      process.stdout.write(JSON.stringify({ manualReview: duplicates }, null, 2) + "\n");
      throw new Error("Duplicate refund requests require manual resolution; no writes performed");
    }
    if (dryRun) process.stdout.write("Preflight passed; would create " + indexName + "\n");
    else {
      await collection.createIndex({ booking: 1 }, { unique: true, name: indexName });
      process.stdout.write("Created " + indexName + "\n");
    }
  }
} finally { await mongoose.disconnect(); }
