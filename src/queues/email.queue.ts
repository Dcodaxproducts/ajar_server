import { Queue } from "bullmq";
import { bullConnection } from "./connection";
import { EmailPayload } from "../helpers/node-mailer";

export type EmailJob = EmailPayload;

export const emailQueue = new Queue<EmailJob>("emails", {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    // SMTP is slower to recover than FCM, so start the backoff wider
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
