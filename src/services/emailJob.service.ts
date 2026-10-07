import { EmailPayload, sendEmailOrThrow } from "../helpers/node-mailer";

type SendEmail = (payload: EmailPayload) => Promise<unknown>;

type EmailJobFailure = {
  id?: string;
  name?: string;
  attempts?: number;
  attemptsMade?: number;
};

type EmailJobLogger = {
  warn: (message: string, metadata: Record<string, unknown>) => unknown;
  error: (message: string, metadata: Record<string, unknown>) => unknown;
};

export const EMAIL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export const processEmailJob = async (
  payload: EmailPayload,
  send: SendEmail = sendEmailOrThrow
): Promise<unknown> => send(payload);

export const logEmailJobFailure = (
  job: EmailJobFailure | undefined,
  log: EmailJobLogger
): void => {
  const attempts = job?.attempts ?? 1;
  const attemptsMade = job?.attemptsMade ?? 0;
  const metadata = { jobId: job?.id, jobName: job?.name, attemptsMade };

  if (attemptsMade >= attempts) {
    log.error("Email job exhausted retries", metadata);
    return;
  }

  log.warn("Email job failed and will be retried", metadata);
};
