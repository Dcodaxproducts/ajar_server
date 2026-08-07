import cron from "node-cron";
import { User } from "../models/user.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { DamageReport } from "../models/damageReport.model";
import { RefundRequest } from "../models/refundRequest.model";
import { HelpSupport } from "../models/helpSupport.model";
import { notificationQueue } from "../queues/notification.queue";

const DAY_MS = 24 * 60 * 60 * 1000;
// Only nag about things that have actually been sitting around
const PENDING_FOR_DAYS = 3;
const EVERY_DAY_AT_NINE_AM = "0 9 * * *";

let adminPendingSummaryCron: ReturnType<typeof cron.schedule> | null = null;

export const sendAdminPendingSummary = async () => {
  const cutoff = new Date(Date.now() - PENDING_FOR_DAYS * DAY_MS);

  console.log("[AdminPendingSummaryCron] Started", new Date().toISOString());

  const [listings, verifications, disputes, refunds, reports] = await Promise.all([
    MarketplaceListing.countDocuments({
      status: "pending",
      createdAt: { $lte: cutoff },
    }),
    User.countDocuments({
      documents: { $elemMatch: { status: "pending", createdAt: { $lte: cutoff } } },
    }),
    DamageReport.countDocuments({ status: "pending", createdAt: { $lte: cutoff } }),
    RefundRequest.countDocuments({ status: "pending", createdAt: { $lte: cutoff } }),
    HelpSupport.countDocuments({ status: "pending", createdAt: { $lte: cutoff } }),
  ]);

  const parts: string[] = [];
  if (listings) parts.push(`${listings} listing approval${listings > 1 ? "s" : ""}`);
  if (verifications) parts.push(`${verifications} user verification${verifications > 1 ? "s" : ""}`);
  if (disputes) parts.push(`${disputes} dispute review${disputes > 1 ? "s" : ""}`);
  if (refunds) parts.push(`${refunds} refund request${refunds > 1 ? "s" : ""}`);
  if (reports) parts.push(`${reports} support report${reports > 1 ? "s" : ""}`);

  if (parts.length === 0) {
    console.log("[AdminPendingSummaryCron] Nothing pending");
    return;
  }

  const summary =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  const admins = await User.find({ role: "admin" }).select("_id").lean();

  for (const admin of admins) {
    await notificationQueue.add("admin-pending-summary", {
      userId: admin._id.toString(),
      title: "Pending Actions",
      message: `${summary} have been waiting more than ${PENDING_FOR_DAYS} days and need your review.`,
      data: {
        type: "admin",
        listings,
        verifications,
        disputes,
        refunds,
        reports,
      },
    });
  }

  console.log(
    `[AdminPendingSummaryCron] Notified ${admins.length} admin(s): ${summary}`
  );
};

export const startAdminPendingSummaryCron = () => {
  if (adminPendingSummaryCron) return adminPendingSummaryCron;

  console.log("[AdminPendingSummaryCron] Scheduling daily job");

  adminPendingSummaryCron = cron.schedule(EVERY_DAY_AT_NINE_AM, () => {
    sendAdminPendingSummary().catch((error) => {
      console.error("[AdminPendingSummaryCron] Failed:", error);
    });
  });

  return adminPendingSummaryCron;
};
