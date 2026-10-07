import assert from "node:assert/strict";
import test from "node:test";
import {
  OtpDeliveryUnavailableError,
  OtpRecipient,
  persistAndQueueOtp,
} from "../services/otpDelivery.service";
import {
  EMAIL_JOB_OPTIONS,
  processEmailJob,
} from "../services/emailJob.service";
import { EmailPayload } from "../helpers/node-mailer";

const makeRecipient = (): OtpRecipient => ({
  email: "person@example.com",
  name: "Person",
  otp: { code: "", expiry: new Date(0), isVerified: false },
  save: async () => undefined,
});

test("registration persists the same OTP that is acknowledged by the queue", async () => {
  const recipient = makeRecipient();
  let persistedCode = "";
  let queuedPayload: EmailPayload | undefined;
  recipient.save = async () => {
    persistedCode = recipient.otp.code;
  };

  await persistAndQueueOtp({
    recipient,
    purpose: "registration",
    generateCode: () => "1234",
    now: () => 1_000,
    enqueue: async (name, payload) => {
      assert.equal(name, "registration-otp");
      queuedPayload = payload;
      return { id: "job-1" };
    },
  });

  assert.equal(persistedCode, "1234");
  assert.match(queuedPayload?.content ?? "", /1234/);
  assert.equal(recipient.otp.expiry.getTime(), 301_000);
});

test("resend persists the same replacement OTP that is acknowledged by the queue", async () => {
  const recipient = makeRecipient();
  recipient.otp.code = "1111";
  let queuedPayload: EmailPayload | undefined;

  await persistAndQueueOtp({
    recipient,
    purpose: "resend",
    generateCode: () => "9876",
    enqueue: async (name, payload) => {
      assert.equal(name, "resend-otp");
      queuedPayload = payload;
      return { id: "job-2" };
    },
  });

  assert.equal(recipient.otp.code, "9876");
  assert.match(queuedPayload?.content ?? "", /9876/);
});

test("enqueue failure preserves the persisted OTP for a later resend", async () => {
  const recipient = makeRecipient();
  let saved = false;
  recipient.save = async () => {
    saved = true;
  };

  await assert.rejects(
    persistAndQueueOtp({
      recipient,
      purpose: "registration",
      generateCode: () => "2468",
      enqueue: async () => {
        throw new Error("queue unavailable");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof OtpDeliveryUnavailableError);
      assert.equal(error.code, "OTP_DELIVERY_UNAVAILABLE");
      return true;
    }
  );
  assert.equal(saved, true);
  assert.equal(recipient.otp.code, "2468");
  assert.equal(recipient.otp.isVerified, false);
});

test("email processor propagates delivery errors so BullMQ can retry", async () => {
  const payload: EmailPayload = {
    to: "person@example.com",
    name: "Person",
    subject: "subject",
    content: "sensitive code",
  };

  await assert.rejects(
    processEmailJob(payload, async () => {
      throw new Error("smtp unavailable");
    }),
    /smtp unavailable/
  );
  assert.equal(EMAIL_JOB_OPTIONS.attempts, 3);
  assert.deepEqual(EMAIL_JOB_OPTIONS.backoff, {
    type: "exponential",
    delay: 5000,
  });
});
