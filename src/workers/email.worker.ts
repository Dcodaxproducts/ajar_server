import { Worker, Job } from "bullmq";
import { bullConnection } from "../queues/connection";
import { EmailJob } from "../queues/email.queue";
import { sendEmailOrThrow } from "../helpers/node-mailer";

export const startEmailWorker = () => {
  const worker = new Worker<EmailJob>(
    "emails",
    async (job: Job<EmailJob>) => {
      const response = await sendEmailOrThrow(job.data);
      return { to: job.data.to, response };
    },
    {
      connection: bullConnection,
      // SMTP servers rate-limit parallel connections, so stay below the
      // transporter's maxConnections
      concurrency: 3,
    }
  );

  worker.on("completed", (job) =>
    console.log(`✅ [emails] job ${job.id} sent to ${job.data.to}`)
  );

  worker.on("failed", (job, err) =>
    console.error(
      `❌ [emails] job ${job?.id} failed (attempt ${job?.attemptsMade}/3):`,
      err.message
    )
  );

  console.log("📧 Email worker started");
  return worker;
};
