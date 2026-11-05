export const DAMAGE_DISPUTE_DECISIONS = ["approved", "rejected"] as const;

// Story 2 state machine: terminal states have no outgoing transition.
export const DAMAGE_DISPUTE_REVIEW_TRANSITIONS = {
  pending: DAMAGE_DISPUTE_DECISIONS,
  approved: [],
  rejected: [],
} as const;
export type DamageDisputeDecision = (typeof DAMAGE_DISPUTE_DECISIONS)[number];

export type DamageDisputeDecisionInput = {
  decision: unknown;
  reason: unknown;
  approvedAmount: unknown;
  currency: unknown;
  evidenceReferences: unknown;
  expectedVersion: unknown;
  idempotencyKey: unknown;
};

export type ValidDamageDisputeDecision = {
  decision: DamageDisputeDecision;
  reason: string;
  approvedAmount: number;
  currency: "SAR";
  evidenceReferences: string[];
  expectedVersion: number;
  idempotencyKey: string;
};

export type DecisionValidationResult =
  | { ok: true; value: ValidDamageDisputeDecision }
  | { ok: false; code: string };

export const isSafeEvidenceReference = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 500) return false;
  if (new RegExp("^/uploads/[A-Za-z0-9][A-Za-z0-9._/-]*$").test(value) && !value.includes("..")) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const validateDamageDisputeDecision = (
  input: DamageDisputeDecisionInput,
  claimedAmount: number,
  depositAmount: number,
  submittedEvidence: string[]
): DecisionValidationResult => {
  if (!DAMAGE_DISPUTE_DECISIONS.includes(input.decision as DamageDisputeDecision)) {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_DECISION" };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3 || reason.length > 2000) {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_REASON" };
  }
  if (input.currency !== "SAR") {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_CURRENCY" };
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_VERSION" };
  }
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_IDEMPOTENCY_KEY" };
  }
  const evidenceReferences = Array.isArray(input.evidenceReferences)
    ? input.evidenceReferences
    : [];
  if (evidenceReferences.length > 20 || !evidenceReferences.every(isSafeEvidenceReference)) {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_EVIDENCE" };
  }
  if (evidenceReferences.some((reference) => !submittedEvidence.includes(reference))) {
    return { ok: false, code: "DAMAGE_DISPUTE_UNKNOWN_EVIDENCE" };
  }
  const approvedAmount = Number(input.approvedAmount);
  if (!Number.isFinite(approvedAmount) || approvedAmount < 0 || Math.round(approvedAmount * 100) !== approvedAmount * 100) {
    return { ok: false, code: "DAMAGE_DISPUTE_INVALID_AMOUNT" };
  }
  if (input.decision === "rejected" && approvedAmount !== 0) {
    return { ok: false, code: "DAMAGE_DISPUTE_REJECTION_AMOUNT_MUST_BE_ZERO" };
  }
  if (
    input.decision === "approved" &&
    (approvedAmount <= 0 || approvedAmount > claimedAmount || approvedAmount > depositAmount)
  ) {
    return { ok: false, code: "DAMAGE_DISPUTE_APPROVED_AMOUNT_OUT_OF_BOUNDS" };
  }
  return {
    ok: true,
    value: {
      decision: input.decision as DamageDisputeDecision,
      reason,
      approvedAmount,
      currency: "SAR",
      evidenceReferences,
      expectedVersion,
      idempotencyKey,
    },
  };
};
