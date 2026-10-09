# Damage dispute and security-deposit contract

## Domain state and invariants

- Booking deposit states are `none -> held -> disputed -> released | partially_refunded | deducted`; terminal states never move back to `held` or `disputed`.
- Damage disputes are `pending -> approved | partially_approved | dismissed` (the persisted legacy value for dismissed is `rejected` for backward compatibility). Settled disputes are immutable.
- At most one dispute exists per booking. The database unique index on `booking` is authoritative; API pre-checks are only friendly errors.
- A dispute requires a returned booking (`completed`, or an early return with verified return PIN), the authenticated booking lessor, a positive amount no greater than the snapshotted held deposit, bounded text/evidence, and a deposit still in `held` state.
- Renters may read disputes for bookings they rent; they never create, edit, delete, approve, partially approve, dismiss, or reset them.

## Window and clock

- Scope: zone + subcategory rental-policy `securityDepositRules.disputeWindowDays`; default 7 days; accepted range 0-30 whole days.
- The value is snapshotted on booking creation as `depositDisputeWindowDays`. Later policy changes do not alter existing bookings.
- At actual UTC return/completion, `disputeWindowEndsAt = actualReturnAt + snapshotDays * 24h`. The stored timestamp is authoritative.
- The interval is half-open: submission is allowed when `now < disputeWindowEndsAt`; at exactly the deadline it is expired. Automatic release is eligible when `now >= disputeWindowEndsAt`.
- Submission transactionally claims `held -> disputed` only while `now < deadline`. The release worker conditionally persists `held -> release_pending` only while `now >= deadline`; `release_pending` survives restarts and is retryable. The half-open boundary and conditional states make the paths mutually exclusive.

## API and authorization

- `POST /api/tickets`: authenticated user who owns the booking as lessor; multipart evidence constraints apply.
- `GET /api/tickets` and `GET /api/tickets/:id`: admin, booking lessor, or booking renter, scoped server-side.
- `PATCH /api/tickets/:id/status`: admin only; explicit `approved`, `partially_approved`, or legacy `rejected` (dismiss). Resolver, reason/note, approved amount, and timestamps are audited.
- Generic dispute mutation/deletion and resetting to pending are not public operations.

## Stripe settlement and idempotency

- The current checkout intentionally uses one manual-capture PaymentIntent for rental price plus deposit, and captures it when the lessor approves the booking. Therefore this is **not** a long-lived card authorization through the rental: it is a captured charge with the deposit retained as a refundable balance. This avoids pretending a card authorization can survive beyond Stripe/card-network `capture_before` (commonly about 7 days). No reauthorization mechanism exists in this repository.
- Booking completion does not refund the deposit. No-dispute expiry and Admin settlement refund the appropriate captured amount.
- Every refund uses a deterministic Stripe idempotency key derived from booking + settlement purpose/version. A persisted refund id makes retries safe. Stripe-success/DB-failure retries receive the same Stripe Refund and then reconcile local state. One outcome-independent key per dispute prevents a failed local commit from later refunding again under a different Admin outcome.
- Admin approval retains the approved amount for lessor ledger settlement and refunds only the remainder; partial approval must be positive and no greater than both claim and deposit. Dismiss refunds all.
- Refund failures leave the booking claim in a retryable state; no terminal DB state is committed before Stripe acknowledges. Webhook reconciliation remains desirable, but this repository currently has no refund webhook state machine; idempotent retry is the recovery mechanism.

## Jobs, retries, notifications, existing data

- The restart-safe scheduled scanner runs at startup and every 15 minutes, handles bounded batches, resumes `release_pending`, retries failures, and makes stale candidates no-op through conditional claims.
- Notifications are queued only after committed state and are best-effort; renter, lessor, and Admin messages distinguish submission, partial/full approval, dismissal, and automatic release. EN/AR API messages remain localized.
- Existing completed records need an idempotent dry-run-first backfill of snapshot/deadline/deposit state before enabling release. Derive actual return from `bookingDates.returnDate`, then `returnVerifiedAt`, then `dates.checkOut`; records without a captured booking payment or reliable return timestamp must be reported for manual review, not auto-released. Any existing dispute, prior refund marker, partially/refunded payment, or non-safe deposit state also requires manual review; the backfill never overwrites an existing state or deadline.
- Deployment order is mandatory: database backup -> `--apply --dry-run` -> resolve every manual-review/duplicate record -> `--apply` (which builds the unique dispute index before making bookings releasable) -> start the new application/cron. Do not start the new application first because Mongoose may attempt to build the same unique index during startup. Rollback restores only fields written by the selected migration ID and deliberately keeps the uniqueness invariant. This change does not run production migration or deployment.
