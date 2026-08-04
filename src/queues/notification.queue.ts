import { Queue } from "bullmq";
import { bullConnection } from "./connection";

export type NotificationJob = {
  userId: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  // Set by the worker once the DB row exists, so a retry doesn't create a duplicate
  notificationId?: string;
};

export const notificationQueue = new Queue<NotificationJob>("notifications", {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
