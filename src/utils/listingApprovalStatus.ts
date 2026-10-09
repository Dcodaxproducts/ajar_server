export const LISTING_APPROVAL_STATUSES = [
  "approved",
  "pending",
  "rejected",
] as const;

export type ListingApprovalStatus = (typeof LISTING_APPROVAL_STATUSES)[number];

const STATUS_ALIASES: Record<string, ListingApprovalStatus> = {
  accept: "approved",
  accepted: "approved",
  approve: "approved",
  approved: "approved",
  awaiting_approval: "pending",
  pending: "pending",
  pending_approval: "pending",
  under_review: "pending",
  decline: "rejected",
  declined: "rejected",
  denied: "rejected",
  reject: "rejected",
  rejected: "rejected",
};

const normalizeStatusKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

export const canonicalizeListingApprovalStatus = (
  value: unknown
): ListingApprovalStatus | null => {
  if (typeof value !== "string") return null;
  return STATUS_ALIASES[normalizeStatusKey(value)] ?? null;
};

export const parseListingApprovalStatusQuery = (
  value: unknown
): ListingApprovalStatus | undefined => {
  if (value === undefined) return undefined;
  const status = canonicalizeListingApprovalStatus(value);
  if (!status || value !== status) {
    throw new TypeError("Invalid listing approval status");
  }
  return status;
};

export const listingApprovalStatusValues = (
  status: ListingApprovalStatus
): string[] =>
  Object.entries(STATUS_ALIASES)
    .filter(([, canonical]) => canonical === status)
    .map(([persisted]) => persisted);

export const buildListingNameSearch = (value: unknown): RegExp | undefined => {
  if (typeof value !== "string") return undefined;
  const term = value.trim().slice(0, 100);
  if (!term) return undefined;
  const escaped = term.replace(
    /[.*+?^${}()|[\]\\]/g,
    (character) => String.fromCharCode(92) + character
  );
  return new RegExp(escaped, "i");
};

export const addCanonicalApprovalStatus = <T extends Record<string, unknown>>(
  listing: T
): T & { approvalStatus: ListingApprovalStatus | null } => ({
  ...listing,
  approvalStatus: canonicalizeListingApprovalStatus(listing.status),
});
