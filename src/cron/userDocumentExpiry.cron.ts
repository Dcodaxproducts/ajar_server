import cron from "node-cron";
import { User } from "../models/user.model";
import { sendNotification } from "../utils/notifications";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const EVERY_DAY_AT_MIDNIGHT = "0 0 * * *";

let userDocumentExpiryCron: ReturnType<typeof cron.schedule> | null = null;

export const processUserDocumentExpiry = async () => {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + SEVEN_DAYS_MS);

  console.log("[UserDocumentExpiryCron] Started", now.toISOString());

  const users = await User.find({
    role: "user",
    documents: { $elemMatch: { expiryDate: { $exists: true } } },
  })
    .select("documents status")
    .lean();

  console.log(`[UserDocumentExpiryCron] Users found: ${users.length}`);

  for (const user of users) {
    let needsSave = false;
    const expiredDocNames: string[] = [];
    const expiringSoonDocNames: string[] = [];

    const documents = await Promise.all(
      (user.documents ?? []).map(async (document: any) => {
        const expiryDate = document.expiryDate ? new Date(document.expiryDate) : null;

        if (!expiryDate) return document;

        if (expiryDate < now && document.status !== "expired") {
          needsSave = true;
          expiredDocNames.push(document.name);

          await sendNotification(
            user._id.toString(),
            "Document Expired",
            `Your document "${document.name}" has expired. Please renew it to restore your account access.`,
            { type: "system" }
          );

          return { ...document, status: "expired" };
        }

        if (expiryDate > now && expiryDate <= sevenDaysLater && !document.reminderSent) {
          needsSave = true;
          expiringSoonDocNames.push(document.name);

          await sendNotification(
            user._id.toString(),
            "Document Expiring Soon",
            `Your document "${document.name}" will expire in 7 days. Please renew it to avoid account suspension.`,
            { type: "system" }
          );

          return { ...document, reminderSent: true };
        }

        return document;
      })
    );

    const hasExpiredDoc = documents?.some((document: any) => document.status === "expired");
    let status = user.status;

    if (hasExpiredDoc && status !== "inactive") {
      needsSave = true;
      status = "inactive";
    }

    if (!needsSave) continue;

    console.log(
      `[UserDocumentExpiryCron] Updating user ${user._id}: expired=${expiredDocNames.join(", ") || "none"}, expiringSoon=${expiringSoonDocNames.join(", ") || "none"}, status=${status}`
    );

    await User.findByIdAndUpdate(user._id, {
      status,
      documents,
    });
  }

  console.log("[UserDocumentExpiryCron] Finished");
};

export const startUserDocumentExpiryCron = () => {
  if (userDocumentExpiryCron) return;

  console.log("[UserDocumentExpiryCron] Scheduling daily job");

  processUserDocumentExpiry().catch((error) => {
    console.error("User document expiry cron failed:", error);
  });

  userDocumentExpiryCron = cron.schedule(EVERY_DAY_AT_MIDNIGHT, () => {
    console.log("[UserDocumentExpiryCron] Triggered by schedule");

    processUserDocumentExpiry().catch((error) => {
      console.error("User document expiry cron failed:", error);
    });
  });
};
