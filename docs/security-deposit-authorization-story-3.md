# Security-deposit authorization hold (Damage Dispute Story 3)

## Provider constraint

Stripe card PaymentIntents with manual capture are not indefinite escrow. The authoritative expiry is latest_charge.payment_method_details.card.capture_before after confirmation. Ordinary online card authorizations are commonly about seven days; network, card, merchant-category and account eligibility can shorten or extend that value.

Checkout uses two USD PaymentIntents: a booking charge and an independent security deposit. The booking charge excludes the deposit. After deposit confirmation, the server retrieves Stripe's actual capture_before. When that authorization safely covers rental end plus the snapshotted dispute window and one-hour safety margin, the deposit remains an authorization hold. Otherwise the server immediately captures the deposit with a stable idempotency key and records fundingMode=captured_refundable, fallbackReason, captured amount/time, audit event, and refund idempotency key.

The fallback is explicit in the participant/Admin status API and mobile checkout disclosure. If there is no approved damage claim, the captured deposit is refunded in full. A partial approved claim refunds the remainder; a full approved claim retains the captured deposit. Provider retrieval plus stable keys reconcile provider-success/local-crash retries without double capture or refund.

Booking, deposit, dispute decisions, ledger entries, API amounts, Admin decisions, and mobile disclosure use USD. The server rejects non-USD dispute decisions and non-USD deposit PaymentIntents; it never converts or silently mixes currencies.

## State machine

- AUTHORIZED_HELD or CAPTURED_REFUNDABLE -> RELEASE_SCHEDULED -> RELEASED_NO_DISPUTE
- AUTHORIZED_HELD, CAPTURED_REFUNDABLE, or RELEASE_SCHEDULED -> DISPUTE_OPEN -> SETTLEMENT_SCHEDULED
- Approved -> ADMIN_APPROVED_CAPTURED or ADMIN_APPROVED_PARTIALLY_CAPTURED
- Rejected -> ADMIN_REJECTED_RELEASED
- Recovery uses FAILED_RETRYABLE, PROVIDER_ACTION_REQUIRED, and EXPIRED.

The record persists booking/renter/dispute references, provider PaymentIntent ID, integer minor-unit authorized/capturable/captured/refunded amounts, USD currency, funding mode, fallback reason/timestamps, provider refund reference, capture deadline, dispute deadline, next action/time, attempts, sanitized error code, lease, version, deterministic capture/release/refund keys, notification keys and audit entries. No card data or secret is stored or returned.

The dispute interval is half-open. Submission requires checkedAt < disputeDeadline and atomically changes the authorization to DISPUTE_OPEN in the same Mongo transaction as dispute creation. The worker only claims nextActionAt <= now from releasable states.

## Jobs, webhooks, and recovery

Set ENABLE_SECURITY_DEPOSIT_HOLD_WORKER=true only after preflight. The database is durable truth; Redis is only for deterministic notification jobs. The indexed sweeper batches 25, uses two-minute leases, caps retries at eight with backoff and jitter, and never holds a DB lock across Stripe calls.

Action keys are stable per booking and purpose. Every retry retrieves provider state first, recovering provider-success/local-crash cases. Authorization mode uses amount_to_capture and final capture releases the uncaptured remainder. Fallback mode refunds authorized minus approved with a stable refund key. Captures, retained amounts, and refunds cannot exceed the USD deposit.

The signed webhook verifies before mutation, claims event IDs with recoverable leases, and marks processed after reconciliation. Terminal guards handle out-of-order events. Notifications use deterministic job IDs and occur only after confirmed terminal state.

## API contract

- Booking payment adds depositClientSecret and depositPaymentIntentId; mobile confirms/verifies deposit first, then booking charge.
- GET /api/tickets/deposit/:bookingId returns scoped sanitized status, amounts, deadlines and retry/manual-review flags.
- Story-2 decision stays immutable and schedules settlement.
- POST /api/tickets/:id/settlement/retry is Admin-only and only accepts FAILED_RETRYABLE below the retry cap.

## Migration and rollout preflight (not executed)

1. Back up MongoDB and verify restore.
2. Deploy with ENABLE_SECURITY_DEPOSIT_HOLD_WORKER=false. No new environment value is required for fallback.
3. Build unique bookingId/providerPaymentIntentId indexes and the sweeper index in staging; resolve duplicates first.
4. Existing captured/refundable deposits cannot be converted into authorizations. Keep them on the legacy reviewed path.
5. For uncaptured intents, use a separately approved dry-run tool to verify ownership, currency, amount, status and actual capture_before before idempotent document creation. Mismatches require manual review.
6. Confirm webhook event configuration and signature secret without exposing it.
7. Rehearse both authorization-hold and short/missing capture_before fallback paths in Stripe test mode before enabling one worker. STRIPE_CARD_AUTHORIZATION_MAX_HOURS remains advisory only; actual capture_before is authoritative.
8. Alert on PROVIDER_ACTION_REQUIRED, FAILED_RETRYABLE, attempts >= 8, overdue nextActionAt, stale leases, and safety-margin deadlines. Recover with provider retrieval and the original idempotency key.
