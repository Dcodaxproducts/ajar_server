import { Worker, Job, UnrecoverableError } from "bullmq";
import { bullConnection } from "../queues/connection";
import { NotificationJob } from "../queues/notification.queue";
import {
  createNotification,
  sendPushToUser,
  clearFcmToken,
} from "../utils/notifications";

// FCM errors that will never succeed on a retry — the token is gone for good
const PERMANENT_FCM_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
];

export const startNotificationWorker = () => {
  const worker = new Worker<NotificationJob>(
    "notifications",
    async (job: Job<NotificationJob>) => {
      const { userId, title, message, data } = job.data;

      // Save in DB only on the first attempt — retries reuse the existing row
      if (!job.data.notificationId) {
        const notification = await createNotification(
          userId,
          title,
          message,
          data ?? {}
        );

        await job.updateData({
          ...job.data,
          notificationId: (notification._id as string).toString(),
        });
      }

      // Push is the flaky part, so only this gets retried
      try {
        const result = await sendPushToUser(userId, title, message, data ?? {});

        return {
          notificationId: job.data.notificationId,
          pushed: !result.skipped,
        };
      } catch (err: any) {
        const code = err?.errorInfo?.code;

        if (PERMANENT_FCM_CODES.includes(code)) {
          await clearFcmToken(userId);
          throw new UnrecoverableError(`FCM permanent error: ${code}`);
        }

        throw err;
      }
    },
    {
      connection: bullConnection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) =>
    console.log(`✅ [notifications] job ${job.id} done`)
  );

  worker.on("failed", (job, err) =>
    console.error(
      `❌ [notifications] job ${job?.id} failed (attempt ${job?.attemptsMade}/3):`,
      err.message
    )
  );

  console.log("👷 Notification worker started");
  return worker;
};
