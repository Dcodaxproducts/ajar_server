import { createHmac, randomInt, timingSafeEqual } from "crypto";

export const OTP_EXPIRY_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpPurpose = "registration" | "password-reset";

export type OtpState = {
  isVerified: boolean;
  code: string;
  expiry: Date;
  attempts: number;
  lastSentAt?: Date;
  purpose?: OtpPurpose;
};

export class OtpConfigurationError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("OTP verification is temporarily unavailable.");
    this.name = "OtpConfigurationError";
  }
}

export class OtpRateLimitError extends Error {
  readonly statusCode = 429;

  constructor() {
    super("Please wait before requesting another verification code.");
    this.name = "OtpRateLimitError";
  }
}

const secret = (env: NodeJS.ProcessEnv = process.env): string => {
  const value = env.OTP_HASH_SECRET?.trim();
  if (!value || value.length < 32) throw new OtpConfigurationError();
  return value;
};

const digest = (code: string, env?: NodeJS.ProcessEnv): Buffer =>
  createHmac("sha256", secret(env)).update(code).digest();

export const hashOtp = (
  code: string,
  env: NodeJS.ProcessEnv = process.env
): string => digest(code, env).toString("hex");

export const issueOtp = (
  purpose: OtpPurpose,
  current?: OtpState,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env
): { code: string; state: OtpState } => {
  if (
    current?.lastSentAt &&
    now.getTime() - current.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    throw new OtpRateLimitError();
  }

  const code = randomInt(1000, 10000).toString();
  return {
    code,
    state: {
      code: hashOtp(code, env),
      expiry: new Date(now.getTime() + OTP_EXPIRY_MS),
      isVerified: false,
      attempts: 0,
      lastSentAt: now,
      purpose,
    },
  };
};

export const verifyOtpState = (
  current: OtpState,
  candidate: string,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env
): { valid: boolean; state: OtpState } => {
  const failedState = {
    ...current,
    attempts: Math.min((current.attempts ?? 0) + 1, OTP_MAX_ATTEMPTS),
  };

  if (
    current.isVerified ||
    !current.code ||
    !current.purpose ||
    current.expiry.getTime() < now.getTime() ||
    (current.attempts ?? 0) >= OTP_MAX_ATTEMPTS
  ) {
    return { valid: false, state: failedState };
  }

  const expected = Buffer.from(current.code, "hex");
  const actual = digest(candidate, env);
  const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!valid) return { valid: false, state: failedState };

  return {
    valid: true,
    state: {
      ...current,
      code: "",
      expiry: new Date(0),
      isVerified: true,
      attempts: 0,
    },
  };
};

export const consumePasswordReset = (current: OtpState): OtpState => {
  if (!current.isVerified || current.purpose !== "password-reset") {
    const error = new Error("OTP verification is required.") as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }

  return {
    code: "",
    expiry: new Date(0),
    isVerified: false,
    attempts: 0,
  };
};
