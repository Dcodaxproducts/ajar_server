export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
};

export class MailConfigurationError extends Error {
  readonly statusCode = 503;

  constructor(message = "Email delivery is temporarily unavailable.") {
    super(message);
    this.name = "MailConfigurationError";
  }
}

const required = (value: string | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) throw new MailConfigurationError();
  return normalized;
};

export const loadMailConfig = (
  env: NodeJS.ProcessEnv = process.env
): MailConfig => {
  const port = Number(env.MAIL_PORT ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailConfigurationError();
  }

  const secureValue = env.MAIL_SECURE?.trim().toLowerCase() ?? "true";
  if (secureValue !== "true" && secureValue !== "false") {
    throw new MailConfigurationError();
  }

  const user = required(env.MAIL_USER);
  return {
    host: required(env.MAIL_HOST),
    port,
    secure: secureValue === "true",
    user,
    password: required(env.MAIL_PASSWORD),
    fromAddress: env.MAIL_FROM_ADDRESS?.trim() || user,
    fromName: env.MAIL_FROM_NAME?.trim() || "AJAR",
  };
};
