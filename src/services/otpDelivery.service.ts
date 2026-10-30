import { EmailPayload } from "../helpers/node-mailer";
import { issueOtp, OtpState } from "./otp.service";

export const OTP_DELIVERY_UNAVAILABLE = "OTP_DELIVERY_UNAVAILABLE";

export type OtpPurpose = "registration" | "resend";

export type OtpRecipient = {
  email: string;
  name: string;
  otp: OtpState;
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
  generateCode,
}: {
  recipient: OtpRecipient;
  purpose: OtpPurpose;
  enqueue: EnqueueEmail;
  now?: () => number;
  generateCode?: () => string;
}): Promise<void> => {
  const otp = issueOtp(
    purpose === "registration"
      ? "registration"
      : recipient.otp.purpose ?? "registration",
    recipient.otp,
    new Date(now()),
    process.env,
    generateCode
  );
  recipient.otp = otp.state;
  await recipient.save();

  try {
    await enqueue(`${purpose}-otp`, buildOtpEmail(recipient, purpose, otp.code));
  } catch {
    // The persisted inactive account and OTP intentionally remain available
    // so the client can retry through the resend endpoint.
    throw new OtpDeliveryUnavailableError();
  }
};
