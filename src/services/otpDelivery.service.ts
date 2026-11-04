import { EmailPayload } from "../helpers/node-mailer";
import { issueOtp, OtpState } from "./otp.service";

export const OTP_DELIVERY_UNAVAILABLE = "OTP_DELIVERY_UNAVAILABLE";

export type OtpPurpose = "registration" | "password-reset" | "resend";

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
  subject:
    purpose === "registration"
      ? "Your OTP Code"
      : purpose === "password-reset"
        ? "Your Password Reset OTP"
        : "Your New OTP Code",
  content: `
    <p>Hello ${recipient.name || "User"},</p>
    <p>Your ${
      purpose === "registration"
        ? "registration"
        : purpose === "password-reset"
          ? "password reset"
          : "new"
    } OTP is:</p>
    <div style="background: #f4f4f4; padding: 10px; color: #2e7d32; border-radius: 5px; border: 1px solid #ccc; display: inline-block;">
      <strong>${otp}</strong>
    </div>
    <p>This OTP will expire in 5 minutes.</p>
  `,
});

export const ensureOtpDeliveryQueueAvailable = async (
  waitUntilReady: () => Promise<unknown>
): Promise<void> => {
  try {
    await waitUntilReady();
  } catch {
    throw new OtpDeliveryUnavailableError();
  }
};

export const queueOtpIfRecipientExists = async ({
  recipient,
  purpose,
  enqueue,
}: {
  recipient: OtpRecipient | null;
  purpose: Exclude<OtpPurpose, "registration">;
  enqueue: EnqueueEmail;
}): Promise<void> => {
  if (!recipient) return;
  await persistAndQueueOtp({ recipient, purpose, enqueue });
};

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
  const previousOtp = { ...recipient.otp };
  const otp = issueOtp(
    purpose === "resend"
      ? recipient.otp.purpose ?? "registration"
      : purpose,
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
    // Queue acceptance is the durability boundary. Restore the previous state
    // so a Redis outage does not consume the resend cooldown or invalidate a
    // previously delivered OTP.
    recipient.otp = previousOtp;
    try {
      await recipient.save();
    } catch {
      // The delivery error remains the safe public failure. Do not log OTP/PII.
    }
    throw new OtpDeliveryUnavailableError();
  }
};
