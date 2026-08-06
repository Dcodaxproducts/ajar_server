import "dotenv/config"; 
import { server } from "./app";
import { connectDB } from "./config/db";
import { config } from "./config/env";
import { startListingDocumentExpiryCron } from "./cron/listingDocumentExpiry.cron";
import { startSecurityDepositReleaseCron } from "./cron/securityDepositRelease.cron";
import { startUserDocumentExpiryCron } from "./cron/userDocumentExpiry.cron";
import { startUnpaidBookingCleanupCron } from "./cron/unpaidBookingCleanup.cron";
import { initSocket } from "./socket";
import { startNotificationWorker } from "./workers/notification.worker";
import { startEmailWorker } from "./workers/email.worker";
import { seedReminderSettings } from "./queues/reminders";

const PORT = config.PORT || 5001;
let notificationWorker: ReturnType<typeof startNotificationWorker> | null = null;   // 👈 YE line
let emailWorker: ReturnType<typeof startEmailWorker> | null = null;


connectDB().then(() => {
  startListingDocumentExpiryCron();
  startUserDocumentExpiryCron();
  startSecurityDepositReleaseCron();
  startUnpaidBookingCleanupCron();

  notificationWorker = startNotificationWorker();
  emailWorker = startEmailWorker();

  seedReminderSettings().catch((err) =>
    console.error("Failed to seed reminder settings:", err)
  );

  initSocket(server);
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

const shutdown = async (signal: string) => {
  console.log(`\n${signal} received — shutting down...`);
  try {
    await Promise.all([notificationWorker?.close(), emailWorker?.close()]);
    console.log("Workers closed");
  } catch (err) {
    console.error("Shutdown error:", err);
  }
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));


