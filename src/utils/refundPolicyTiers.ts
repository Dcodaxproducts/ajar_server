import type { ICancellationTier } from "../models/refundPolicy.model";

export interface CancellationTierInput {
  hoursBeforeCheckIn?: unknown;
  daysBeforeCheckIn?: unknown;
  percentage?: unknown;
  label?: unknown;
}

export function wholeNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative whole number`);
  }
  return value;
}

export function resolveCancellationTierHours(tier: CancellationTierInput): number {
  const hasHours = tier.hoursBeforeCheckIn !== undefined;
  const hasDays = tier.daysBeforeCheckIn !== undefined;
  if (!hasHours && !hasDays) {
    throw new TypeError("Each cancellation tier requires hoursBeforeCheckIn");
  }

  const hours = hasHours
    ? wholeNonNegativeNumber(tier.hoursBeforeCheckIn, "hoursBeforeCheckIn")
    : undefined;
  const legacyHours = hasDays
    ? wholeNonNegativeNumber(tier.daysBeforeCheckIn, "daysBeforeCheckIn") * 24
    : undefined;

  if (legacyHours !== undefined && !Number.isSafeInteger(legacyHours)) {
    throw new TypeError("daysBeforeCheckIn is too large to convert safely");
  }
  if (hours !== undefined && legacyHours !== undefined && hours !== legacyHours) {
    throw new TypeError("Conflicting hoursBeforeCheckIn and daysBeforeCheckIn values");
  }
  return hours ?? (legacyHours as number);
}

export function normalizeCancellationTiers(value: unknown): ICancellationTier[] {
  if (!Array.isArray(value)) {
    throw new TypeError("tiers must be an array");
  }

  const tiers = value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new TypeError(`tiers[${index}] must be an object`);
    }
    const tier = raw as CancellationTierInput;
    const percentage = wholeNonNegativeNumber(tier.percentage, `tiers[${index}].percentage`);
    if (percentage > 100) {
      throw new TypeError(`tiers[${index}].percentage must not exceed 100`);
    }
    if (tier.label !== undefined && typeof tier.label !== "string") {
      throw new TypeError(`tiers[${index}].label must be a string`);
    }
    return {
      hoursBeforeCheckIn: resolveCancellationTierHours(tier),
      percentage,
      ...(tier.label === undefined ? {} : { label: tier.label }),
    };
  });

  const hours = tiers.map((tier) => tier.hoursBeforeCheckIn);
  if (hours.length !== new Set(hours).size) {
    throw new TypeError("Duplicate hoursBeforeCheckIn values in tiers");
  }
  return tiers;
}
