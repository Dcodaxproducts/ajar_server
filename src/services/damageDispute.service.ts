export const DEFAULT_DISPUTE_WINDOW_DAYS = 7;
export const MAX_DISPUTE_WINDOW_DAYS = 30;
export const MAX_DAMAGE_TEXT_LENGTH = 2000;
export const MAX_ISSUE_TYPE_LENGTH = 100;
export const MAX_DAMAGE_ATTACHMENTS = 5;

export const isValidDisputeWindowDays = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_DISPUTE_WINDOW_DAYS;

export const calculateDisputeDeadline = (
  actualReturnAt: Date,
  snapshottedWindowDays: number
): Date =>
  new Date(
    actualReturnAt.getTime() + snapshottedWindowDays * 24 * 60 * 60 * 1000
  );

// Half-open interval: the exact deadline belongs to the release worker.
export const isDisputeWindowOpen = (now: Date, deadline: Date): boolean =>
  now.getTime() < deadline.getTime();

export const validateDamageDisputeInput = ({
  damagedCharges,
  heldDeposit,
  rentalText,
  issueType,
  attachmentCount,
}: {
  damagedCharges: unknown;
  heldDeposit: number;
  rentalText: unknown;
  issueType: unknown;
  attachmentCount: number;
}): string | null => {
  const amount = Number(damagedCharges);
  if (
    !Number.isFinite(amount) ||
    amount < 0.01 ||
    Number(amount.toFixed(2)) !== amount
  ) return "invalidAmount";
  if (amount > heldDeposit) return "amountExceedsDeposit";
  if (typeof rentalText !== "string" || rentalText.trim().length === 0 || rentalText.length > MAX_DAMAGE_TEXT_LENGTH) {
    return "invalidRentalText";
  }
  if (typeof issueType !== "string" || issueType.trim().length === 0 || issueType.length > MAX_ISSUE_TYPE_LENGTH) {
    return "invalidIssueType";
  }
  if (!Number.isInteger(attachmentCount) || attachmentCount < 0 || attachmentCount > MAX_DAMAGE_ATTACHMENTS) {
    return "invalidAttachments";
  }
  return null;
};

export const buildDepositRefundIdempotencyKey = (
  bookingId: string,
  settlementReference: string,
  amountCents: number
): string =>
  ["deposit-refund", bookingId, settlementReference, amountCents].join("-").slice(0, 255);

export const canReadDamageDispute = ({
  role,
  userId,
  renterId,
  leaserId,
}: {
  role: string | undefined;
  userId: string | undefined;
  renterId: string | undefined;
  leaserId: string | undefined;
}): boolean =>
  role === "admin" ||
  (!!userId && (userId === renterId || userId === leaserId));
