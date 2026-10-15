# AJAR fields, cancellation refunds, and damage disputes

## Invariants
- Field create and list share the same response envelope; locale affects presentation only and never hides a persisted field. List pagination is bounded and newest-first. Successful mutations invalidate paginated and selector caches.
- Cancellation tiers are canonical whole UTC elapsed hours. At exactly a threshold the tier applies; one millisecond below it does not. Legacy day values are read/migrated only for compatibility and are never emitted.
- Only the booking renter may submit one refund request for their cancelled booking. Only Admin may list/inspect/settle all requests. Pending is immutable to users; settlement is a one-way pending -> processing -> accept/reject state transition.
- Every monetary refund uses a deterministic request+booking scoped Stripe idempotency key. Concurrent/retried acceptance cannot create a second refund; Stripe success can be reconciled after a database failure. A request is not accepted until every required line is settled.
- Damage dispute submission is lessor-only, after verified return/completion, before the snapshotted half-open deadline. Renter is read-only. Deposit remains held through the window; no-dispute expiry releases it, a dispute holds it, and Admin alone settles it. Jobs are bounded, restart-safe and idempotent.

## Error/state matrix
| Operation | Invalid/unauthorized | Duplicate/race | External failure | Success |
|---|---|---|---|---|
| Create field | 400/403, no write | unique conflict | n/a | 201 + persisted entity; list refetch shows it |
| Submit refund | 400/403/404 | 409 existing request | n/a | 201 pending snapshot |
| Reject refund | 400/403/404 | terminal response/no mutation | n/a | reject + audit note |
| Accept refund | 400/403/404 | processing/terminal response; no second Stripe refund | remains retryable/reconcilable | accept only after all lines succeed |
| Submit dispute | 400/403/404/410 expired | unique/conditional state conflict | n/a | pending dispute + held->disputed |
| Auto release/admin settle | 403 or stale no-op | conditional claim/idempotent replay | retryable state retained | audited terminal deposit state |

## Performance and storage
- Field list uses one bounded page query plus count; no cache beyond React Query and mutation invalidation.
- Refund/dispute lookups are booking/user/status scoped; unique indexes prevent duplicates. No Redis is warranted because writes require immediate consistency.
- Scheduled deposit release scans at most 50 candidates per run; each candidate is conditionally claimed before Stripe.

## Migration and rollout
- Take and restore-test a MongoDB backup. Run refund-tier and refund-request uniqueness dry-runs first. The uniqueness preflight reports duplicate booking IDs for manual reconciliation and never chooses a winner automatically.
- Create the named unique booking index before starting application code that relies on it. MongoDB builds the index online but briefly takes collection metadata locks; schedule during low traffic and monitor create latency. Concurrent duplicate insertion during the build makes index creation fail safely.
- Rollback may drop only the named refund-request index; do not reverse hour-tier data without the migration-specific backup. Dispute backfill rollback follows its existing migration ID snapshots and deliberately preserves dispute uniqueness.
- Enable the security-deposit release cron only after deposit backfill/manual-review completion. Deploy backend before Admin UI; no mobile/customer-web change is required for these fixes.
