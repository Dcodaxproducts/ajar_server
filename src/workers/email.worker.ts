import { Worker, Job } from "bullmq";
import { bullConnection } from "../queues/connection";
import { EmailJob } from "../queues/email.queue";
import {
  logEmailJobFailure,
  processEmailJob,
} from "../services/emailJob.service";
import { logger } from "../utils/logger";

export const startEmailWorker = () => {
  const worker = new Worker<EmailJob>(
    "emails",
    async (job: Job<EmailJob>) => {
      const response = await processEmailJob(job.data);
      return { response };
    },
    {
      connection: bullConnection,
      // SMTP servers rate-limit parallel connections, so stay below the
      // transporter's maxConnections
      concurrency: 3,
    }
  );

  worker.on("completed", (job) =>
    logger.info("Email job completed", { jobId: job.id, jobName: job.name })
  );

  worker.on("failed", (job) => {
    // Never pass job.data or the SMTP error: either may contain OTP/PII.
    logEmailJobFailure(
      job
        ? {
            id: job.id,
            name: job.name,
            attempts: job.opts.attempts,
            attemptsMade: job.attemptsMade,
          }
        : undefined,
      logger
    );
  });

  logger.info("Email worker started");
  return worker;
};
