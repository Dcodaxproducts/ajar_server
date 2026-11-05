import test from "node:test";
import assert from "node:assert/strict";
import { loadMailConfig, MailConfigurationError } from "../config/mail";
import { deliverEmail } from "../helpers/node-mailer";

const validEnv = {
  MAIL_HOST: "smtp.example.test",
  MAIL_PORT: "465",
  MAIL_SECURE: "true",
  MAIL_USER: "mailer@example.test",
  MAIL_PASSWORD: "not-a-real-password",
  MAIL_FROM_ADDRESS: "no-reply@example.test",
  MAIL_FROM_NAME: "AJAR",
};

test("loads and validates SMTP configuration", () => {
  const config = loadMailConfig(validEnv);
  assert.equal(config.host, validEnv.MAIL_HOST);
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.fromAddress, validEnv.MAIL_FROM_ADDRESS);
});

test("fails closed when required SMTP configuration is missing", () => {
  assert.throws(() => loadMailConfig({}), MailConfigurationError);
  assert.throws(
    () => loadMailConfig({ ...validEnv, MAIL_PORT: "invalid" }),
    MailConfigurationError
  );
});

test("propagates SMTP delivery failures", async () => {
  const expected = new Error("SMTP authentication failed");
  const mailer = { sendMail: async () => { throw expected; } };
  await assert.rejects(
    deliverEmail(mailer as never, loadMailConfig(validEnv), {
      to: "recipient@example.test",
      name: "Recipient",
      subject: "Test",
      content: "Test",
    }),
    expected
  );
});
