import { randomInt } from "crypto";
import { EmailPayload } from "../helpers/node-mailer";

const OTP_EXPIRY_MS = 5 * 60 * 1000;

export const OTP_DELIVERY_UNAVAILABLE = "OTP_DELIVERY_UNAVAILABLE";

export type OtpPurpose = "registration" | "resend";

type OtpRecord = {
  code: string;
  expiry: Date;
  isVerified: boolean;
};

export type OtpRecipient = {
  email: string;
  name: string;
  otp: OtpRecord;
  save: () => Promise<unknown>;
};

type EnqueueEmail = (name: string, payload: EmailPayload) => Promise<unknown>;

export class OtpDeliveryUnavailableError extends Error {
  readonly code = OTP_DELIVERY_UNAVAILABLE;

  constructor() {
    super(OTP_DELIVERY_UNAVAILABLE);
    this.name = "OtpDeliveryUnavailableError";
  }
}

export const generateOtpCode = (): string => randomInt(1000, 10000).toString();

const buildOtpEmail = (
  recipient: OtpRecipient,
  purpose: OtpPurpose,
  otp: string
): EmailPayload => ({
  to: recipient.email,
  name: recipient.name,
  subject: purpose === "registration" ? "Your OTP Code" : "Your New OTP Code",
  content: `
    <p>Hello ${recipient.name || "User"},</p>
    <p>Your ${purpose === "registration" ? "registration" : "new"} OTP is:</p>
    <div style="background: #f4f4f4; padding: 10px; color: #2e7d32; border-radius: 5px; border: 1px solid #ccc; display: inline-block;">
      <strong>${otp}</strong>
    </div>
    <p>This OTP will expire in 5 minutes.</p>
  `,
});

export const persistAndQueueOtp = async ({
  recipient,
  purpose,
  enqueue,
  now = () => Date.now(),
  generateCode = generateOtpCode,
}: {
  recipient: OtpRecipient;
  purpose: OtpPurpose;
  enqueue: EnqueueEmail;
  now?: () => number;
  generateCode?: () => string;
}): Promise<void> => {
  const otp = generateCode();
  recipient.otp = {
    code: otp,
    expiry: new Date(now() + OTP_EXPIRY_MS),
    isVerified: false,
  };
  await recipient.save();

  try {
    await enqueue(`${purpose}-otp`, buildOtpEmail(recipient, purpose, otp));
  } catch {
    // The persisted inactive account and OTP intentionally remain available
    // so the client can retry through the resend endpoint.
    throw new OtpDeliveryUnavailableError();
  }
};
