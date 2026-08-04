import nodemailer, { Transporter } from "nodemailer";

const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "AJAR";

// Built once and reused — creating a transporter per email meant a fresh SMTP
// handshake on every send
let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (transporter) return transporter;

  const host = process.env.MAIL_HOST;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "Mail configuration is missing. Set MAIL_HOST, MAIL_USER and MAIL_PASSWORD."
    );
  }

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.MAIL_PORT) || 465,
    secure: process.env.MAIL_SECURE !== "false",
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });

  return transporter;
};

export type EmailPayload = {
  to: string;
  name: string;
  subject: string;
  content: string;
};

// Throws on failure so the caller (the email worker) can retry.
export const sendEmailOrThrow = async ({
  to,
  subject,
  content,
}: EmailPayload) => {
  const htmlTemplate = `
      <html>
      <body style="font-family: Arial, sans-serif;">
        <div style="max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          ${content}
        </div>
      </body>
      </html>
    `;

  const info = await getTransporter().sendMail({
    from: `"${MAIL_FROM_NAME}" <${process.env.MAIL_USER}>`,
    to,
    subject,
    html: htmlTemplate,
  });

  return info.response;
};

// Swallows errors — kept for the auth emails (OTP / 2FA) that are still sent
// directly from the request, where a throw would break the endpoint.
export const sendEmail = async (payload: EmailPayload) => {
  try {
    return await sendEmailOrThrow(payload);
  } catch (error) {
    return (error as any).response;
  }
};
