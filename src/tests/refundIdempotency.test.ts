import assert from "node:assert/strict";
import test from "node:test";
import { buildBookingRefundIdempotencyKey } from "../utils/refundIdempotency";

test("booking refund key is deterministic and settlement scoped", () => {
  const key = buildBookingRefundIdempotencyKey("booking-1", "refund-request-1-v1");
  assert.equal(key, buildBookingRefundIdempotencyKey("booking-1", "refund-request-1-v1"));
  assert.notEqual(key, buildBookingRefundIdempotencyKey("booking-1", "refund-request-2-v1"));
  assert.notEqual(key, buildBookingRefundIdempotencyKey("booking-2", "refund-request-1-v1"));
  assert.ok(key.length <= 255);
});
