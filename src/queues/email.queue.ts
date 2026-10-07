import { Queue } from "bullmq";
import { bullConnection } from "./connection";
import { EmailPayload } from "../helpers/node-mailer";
import { EMAIL_JOB_OPTIONS } from "../services/emailJob.service";

export type EmailJob = EmailPayload;

export const emailQueue = new Queue<EmailJob>("emails", {
  connection: bullConnection,
  defaultJobOptions: EMAIL_JOB_OPTIONS,
});
