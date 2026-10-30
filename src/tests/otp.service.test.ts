import test from "node:test";
import assert from "node:assert/strict";
import {
  consumePasswordReset,
  issueOtp,
  OTP_EXPIRY_MS,
  OTP_MAX_ATTEMPTS,
  OtpRateLimitError,
  verifyOtpState,
} from "../services/otp.service";

const env = { OTP_HASH_SECRET: "test-secret-that-is-at-least-32-characters" };
const now = new Date("2026-10-30T06:00:00.000Z");

test("issues a hashed OTP with a five-minute expiry", () => {
  const issued = issueOtp("registration", undefined, now, env);
  assert.match(issued.code, /^\d{4}$/);
  assert.notEqual(issued.state.code, issued.code);
  assert.equal(issued.state.code.length, 64);
  assert.equal(issued.state.expiry.getTime(), now.getTime() + OTP_EXPIRY_MS);
});

test("verifies once and rejects replay", () => {
  const issued = issueOtp("registration", undefined, now, env);
  const first = verifyOtpState(issued.state, issued.code, now, env);
  assert.equal(first.valid, true);
  assert.equal(first.state.code, "");
  const replay = verifyOtpState(first.state, issued.code, now, env);
  assert.equal(replay.valid, false);
});

test("rejects expired OTPs", () => {
  const issued = issueOtp("registration", undefined, now, env);
  const result = verifyOtpState(
    issued.state,
    issued.code,
    new Date(now.getTime() + OTP_EXPIRY_MS + 1),
    env
  );
  assert.equal(result.valid, false);
});

test("counts failed attempts and locks at the attempt limit", () => {
  const issued = issueOtp("registration", undefined, now, env);
  let state = issued.state;
  for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
    state = verifyOtpState(state, "0000", now, env).state;
  }
  assert.equal(state.attempts, OTP_MAX_ATTEMPTS);
  assert.equal(verifyOtpState(state, issued.code, now, env).valid, false);
});

test("enforces resend cooldown without replacing the active OTP", () => {
  const issued = issueOtp("registration", undefined, now, env);
  assert.throws(
    () => issueOtp("registration", issued.state, new Date(now.getTime() + 30_000), env),
    OtpRateLimitError
  );
  assert.equal(verifyOtpState(issued.state, issued.code, now, env).valid, true);
});

test("password-reset authorization is consumed once", () => {
  const issued = issueOtp("password-reset", undefined, now, env);
  const verified = verifyOtpState(issued.state, issued.code, now, env);
  const consumed = consumePasswordReset(verified.state);
  assert.equal(consumed.isVerified, false);
  assert.throws(() => consumePasswordReset(consumed));
});
