import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureOtpDeliveryQueueAvailable,
  OtpDeliveryUnavailableError,
  OtpRecipient,
  persistAndQueueOtp,
  queueOtpIfRecipientExists,
} from "../services/otpDelivery.service";
import {
  EMAIL_JOB_OPTIONS,
  logEmailJobFailure,
  processEmailJob,
} from "../services/emailJob.service";
import { EmailPayload } from "../helpers/node-mailer";

process.env.OTP_HASH_SECRET = "test-only-otp-hash-secret-with-32-characters";

const makeRecipient = (): OtpRecipient => ({
  email: "person@example.com",
  name: "Person",
  otp: { code: "", expiry: new Date(0), isVerified: false, attempts: 0 },
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

  assert.notEqual(persistedCode, "1234");
  assert.equal(persistedCode.length, 64);
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

  assert.notEqual(recipient.otp.code, "9876");
  assert.equal(recipient.otp.code.length, 64);
  assert.match(queuedPayload?.content ?? "", /9876/);
});

test("forgot-password persists and queues a password-reset OTP", async () => {
  const recipient = makeRecipient();
  let queuedPayload: EmailPayload | undefined;

  await persistAndQueueOtp({
    recipient,
    purpose: "password-reset",
    generateCode: () => "8642",
    enqueue: async (name, payload) => {
      assert.equal(name, "password-reset-otp");
      queuedPayload = payload;
      return { id: "job-reset" };
    },
  });

  assert.equal(recipient.otp.purpose, "password-reset");
  assert.notEqual(recipient.otp.code, "8642");
  assert.match(queuedPayload?.subject ?? "", /Password Reset/);
  assert.match(queuedPayload?.content ?? "", /8642/);
});

test("enqueue failure restores OTP state and permits an immediate retry", async () => {
  const recipient = Object.assign(makeRecipient(), {
    status: "inactive",
    stripe: { customerId: "cus_existing" },
  });
  const previousOtp = { ...recipient.otp };
  let saves = 0;
  recipient.save = async () => {
    saves += 1;
  };

  await assert.rejects(
    persistAndQueueOtp({
      recipient,
      purpose: "registration",
      generateCode: () => "2468",
      now: () => 1_000,
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

  assert.equal(saves, 2);
  assert.deepEqual(recipient.otp, previousOtp);
  assert.equal(recipient.status, "inactive");
  assert.equal(recipient.stripe.customerId, "cus_existing");

  await persistAndQueueOtp({
    recipient,
    purpose: "resend",
    generateCode: () => "1357",
    now: () => 1_000,
    enqueue: async () => ({ id: "job-retry" }),
  });
  assert.equal(recipient.otp.code.length, 64);
});

test("queue availability failures expose only the safe delivery error", async () => {
  await assert.rejects(
    ensureOtpDeliveryQueueAvailable(async () => {
      throw new Error("redis://user:password@internal-host");
    }),
    OtpDeliveryUnavailableError
  );
});

test("unknown account requests do not enqueue mail or expose account state", async () => {
  let enqueueCalls = 0;
  await queueOtpIfRecipientExists({
    recipient: null,
    purpose: "password-reset",
    enqueue: async () => {
      enqueueCalls += 1;
    },
  });
  assert.equal(enqueueCalls, 0);
});

test("request flow cannot report success before BullMQ accepts the OTP job", async () => {
  const recipient = makeRecipient();
  let acceptJob!: () => void;
  let completed = false;

  const operation = persistAndQueueOtp({
    recipient,
    purpose: "registration",
    generateCode: () => "1357",
    enqueue: () =>
      new Promise<void>((resolve) => {
        acceptJob = resolve;
      }),
  }).then(() => {
    completed = true;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false);

  acceptJob();
  await operation;
  assert.equal(completed, true);
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

test("worker logs retry and terminal failure without OTP, recipient, or SMTP details", () => {
  const entries: Array<{
    level: "warn" | "error";
    message: string;
    metadata: Record<string, unknown>;
  }> = [];
  const capture = {
    warn: (message: string, metadata: Record<string, unknown>) => {
      entries.push({ level: "warn", message, metadata });
    },
    error: (message: string, metadata: Record<string, unknown>) => {
      entries.push({ level: "error", message, metadata });
    },
  };

  logEmailJobFailure(
    { id: "job-7", name: "registration-otp", attempts: 3, attemptsMade: 1 },
    capture
  );
  logEmailJobFailure(
    { id: "job-7", name: "registration-otp", attempts: 3, attemptsMade: 3 },
    capture
  );

  assert.deepEqual(entries, [
    {
      level: "warn",
      message: "Email job failed and will be retried",
      metadata: {
        jobId: "job-7",
        jobName: "registration-otp",
        attemptsMade: 1,
      },
    },
    {
      level: "error",
      message: "Email job exhausted retries",
      metadata: {
        jobId: "job-7",
        jobName: "registration-otp",
        attemptsMade: 3,
      },
    },
  ]);

  const serializedLogs = JSON.stringify(entries);
  assert.doesNotMatch(serializedLogs, /person@example\.com/);
  assert.doesNotMatch(serializedLogs, /2468/);
  assert.doesNotMatch(serializedLogs, /smtp unavailable/i);
  assert.doesNotMatch(serializedLogs, /content|recipient|job\.data/i);
});
