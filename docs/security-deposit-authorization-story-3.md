# Security-deposit authorization hold (Damage Dispute Story 3)

## Provider constraint

Stripe card PaymentIntents with manual capture are not indefinite escrow. The authoritative expiry is latest_charge.payment_method_details.card.capture_before after confirmation. Ordinary online card authorizations are commonly about seven days; network, card, merchant-category and account eligibility can shorten or extend that value. This implementation never assumes an extension and never changes to charge-and-refund semantics.

Checkout uses two PaymentIntents: a booking charge and an independent security-deposit authorization. The booking charge excludes the deposit. Checkout preflights STRIPE_CARD_AUTHORIZATION_MAX_HOURS (default 168), then confirms against actual capture_before. Rental end plus the snapshotted dispute window and one-hour safety margin must fit. Otherwise the API returns DEPOSIT_AUTHORIZATION_WINDOW_UNSUPPORTED or persists PROVIDER_ACTION_REQUIRED. It does not capture funds to hide incompatibility.

The current seven-day default dispute window cannot fit inside an ordinary seven-day authorization once rental duration and the safety margin are included. Operations must configure a shorter eligible combination, verify Stripe extended-authorization eligibility, or approve a different product design.

A second explicit blocker exists in the cumulative contract: Story 2 records decisions in SAR while the existing booking/deposit PaymentIntents use USD. Approved capture enters PROVIDER_ACTION_REQUIRED with DEPOSIT_DECISION_CURRENCY_MISMATCH; no conversion or capture occurs. Rejection can still release the authorization. Operations/product must align the booking and decision currencies before approved settlements can execute.

## State machine

- AUTHORIZED_HELD -> RELEASE_SCHEDULED -> RELEASED_NO_DISPUTE
- AUTHORIZED_HELD or RELEASE_SCHEDULED -> DISPUTE_OPEN -> SETTLEMENT_SCHEDULED
- Approved -> ADMIN_APPROVED_CAPTURED or ADMIN_APPROVED_PARTIALLY_CAPTURED
- Rejected -> ADMIN_REJECTED_RELEASED
- Recovery uses FAILED_RETRYABLE, PROVIDER_ACTION_REQUIRED, and EXPIRED.

The record persists booking/renter/dispute references, provider PaymentIntent ID, integer minor-unit amounts, currency, capture deadline, dispute deadline, next action/time, attempts, sanitized error code, lease, version, deterministic idempotency keys, notification keys and audit entries. No card data or secret is stored or returned.

The dispute interval is half-open. Submission requires checkedAt < disputeDeadline and atomically changes the authorization to DISPUTE_OPEN in the same Mongo transaction as dispute creation. The worker only claims nextActionAt <= now from releasable states.

## Jobs, webhooks, and recovery

Set ENABLE_SECURITY_DEPOSIT_HOLD_WORKER=true only after preflight. The database is durable truth; Redis is only for deterministic notification jobs. The indexed sweeper batches 25, uses two-minute leases, caps retries at eight with backoff and jitter, and never holds a DB lock across Stripe calls.

Action keys are stable per booking and purpose. Every retry retrieves provider state first, recovering provider-success/local-crash cases. Partial capture uses amount_to_capture and final capture releases the uncaptured remainder. Captures cannot exceed approved claim, deposit authorization, or current capturable amount.

The signed webhook verifies before mutation, claims event IDs with recoverable leases, and marks processed after reconciliation. Terminal guards handle out-of-order events. Notifications use deterministic job IDs and occur only after confirmed terminal state.

## API contract

- Booking payment adds depositClientSecret and depositPaymentIntentId; mobile confirms/verifies deposit first, then booking charge.
- GET /api/damage-report/deposit/:bookingId returns scoped sanitized status, amounts, deadlines and retry/manual-review flags.
- Story-2 decision stays immutable and schedules settlement.
- POST /api/damage-report/:id/settlement/retry is Admin-only and only accepts FAILED_RETRYABLE below the retry cap.

## Migration and rollout preflight (not executed)

1. Back up MongoDB and verify restore.
2. Deploy with ENABLE_SECURITY_DEPOSIT_HOLD_WORKER=false.
3. Build unique bookingId/providerPaymentIntentId indexes and the sweeper index in staging; resolve duplicates first.
4. Existing captured/refundable deposits cannot be converted into authorizations. Keep them on the legacy reviewed path.
5. For uncaptured intents, use a separately approved dry-run tool to verify ownership, currency, amount, status and actual capture_before before idempotent document creation. Mismatches require manual review.
6. Confirm webhook event configuration and signature secret without exposing it.
7. Validate STRIPE_CARD_AUTHORIZATION_MAX_HOURS against account capability and rehearse in Stripe test mode before enabling one worker.
8. Alert on PROVIDER_ACTION_REQUIRED, FAILED_RETRYABLE, attempts >= 8, overdue nextActionAt, stale leases, and safety-margin deadlines. Recover with provider retrieval and the original idempotency key.
