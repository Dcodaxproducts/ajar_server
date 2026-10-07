import { EmailPayload, sendEmailOrThrow } from "../helpers/node-mailer";

type SendEmail = (payload: EmailPayload) => Promise<unknown>;

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
