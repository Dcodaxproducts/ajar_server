import nodemailer, { Transporter } from "nodemailer";
import { loadMailConfig, MailConfig } from "../config/mail";

let transporter: Transporter | null = null;
let transporterKey = "";

export type EmailPayload = {
  to: string;
  name: string;
  subject: string;
  content: string;
};

const getTransporter = (config: MailConfig): Transporter => {
  const key = [config.host, config.port, config.secure, config.user].join("|");
  if (transporter && transporterKey === key) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });
  transporterKey = key;
  return transporter;
};

export const deliverEmail = async (
  mailer: Pick<Transporter, "sendMail">,
  config: MailConfig,
  { to, subject, content }: EmailPayload
): Promise<string> => {
  const info = await mailer.sendMail({
    from: `"${config.fromName}" <${config.fromAddress}>`,
    to,
    subject,
    html: `<html><body style="font-family: Arial, sans-serif;"><div style="max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">${content}</div></body></html>`,
  });
  return info.response;
};

export const verifyMailConnection = async (): Promise<void> => {
  const config = loadMailConfig();
  await getTransporter(config).verify();
};

export const sendEmail = async (payload: EmailPayload): Promise<string> => {
  const config = loadMailConfig();
  return deliverEmail(getTransporter(config), config, payload);
};

export const sendEmailOrThrow = sendEmail;
