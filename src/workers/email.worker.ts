import { Worker, Job } from "bullmq";
import { bullConnection } from "../queues/connection";
import { EmailJob } from "../queues/email.queue";
import { processEmailJob } from "../services/emailJob.service";
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
    const attempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const metadata = { jobId: job?.id, jobName: job?.name, attemptsMade };

    if (attemptsMade >= attempts) {
      // Never log job.data or the SMTP error: either may contain OTP content.
      logger.error("Email job exhausted retries", metadata);
      return;
    }

    logger.warn("Email job failed and will be retried", metadata);
  });

  logger.info("Email worker started");
  return worker;
};
