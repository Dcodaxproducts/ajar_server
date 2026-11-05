export const DEFAULT_DAMAGE_DISPUTE_WINDOW = {
  duration: 7,
  unit: "days",
} as const;

export const MAX_DAMAGE_DISPUTE_WINDOW_DAYS = 30;
export const MAX_DAMAGE_DISPUTE_WINDOW_HOURS =
  MAX_DAMAGE_DISPUTE_WINDOW_DAYS * 24;

export type DamageDisputeWindowUnit = "hours" | "days";

export const DAMAGE_DISPUTE_ERROR_CODES = {
  notFound: "DAMAGE_DISPUTE_BOOKING_NOT_FOUND",
  wrong_status: "DAMAGE_DISPUTE_BOOKING_NOT_ELIGIBLE",
  not_returned: "DAMAGE_DISPUTE_RETURN_NOT_VERIFIED",
  expired: "DAMAGE_DISPUTE_WINDOW_EXPIRED",
  already_submitted: "DAMAGE_DISPUTE_ALREADY_SUBMITTED",
} as const;

export const isDamageDisputeLessor = (
  userId: string | undefined,
  bookingLessorId: string | undefined
): boolean => Boolean(userId && bookingLessorId && userId === bookingLessorId);

export interface DamageDisputeWindowConfig {
  duration: number;
  unit: DamageDisputeWindowUnit;
}

export type DamageDisputeWindowState =
  | "open"
  | "expired"
  | "not_returned"
  | "wrong_status"
  | "already_submitted";

export interface DamageDisputeBookingSnapshot {
  status: string;
  cancelledFromStatus?: string;
  returnVerifiedAt?: Date | null;
  damageDisputeId?: unknown;
  damageDisputeWindow?: unknown;
  depositDisputeWindowDays?: unknown;
}

export interface DamageDisputeEligibility {
  eligible: boolean;
  state: DamageDisputeWindowState;
  checkedAt: Date;
  rentalEndAt: Date | null;
  deadlineAt: Date | null;
  window: DamageDisputeWindowConfig;
}

export const isDamageDisputeWindowConfig = (
  value: unknown
): value is DamageDisputeWindowConfig => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<DamageDisputeWindowConfig>;
  if (!Number.isInteger(candidate.duration) || Number(candidate.duration) < 1) {
    return false;
  }

  if (candidate.unit === "hours") {
    return Number(candidate.duration) <= MAX_DAMAGE_DISPUTE_WINDOW_HOURS;
  }

  if (candidate.unit === "days") {
    return Number(candidate.duration) <= MAX_DAMAGE_DISPUTE_WINDOW_DAYS;
  }

  return false;
};

/**
 * Resolves the centrally configured booking snapshot. Invalid or missing values
 * fail safe to seven UTC days. Legacy disputeWindowDays snapshots remain
 * readable while clients migrate to { duration, unit }.
 */
export const resolveDamageDisputeWindow = ({
  damageDisputeWindow,
  depositDisputeWindowDays,
}: Pick<
  DamageDisputeBookingSnapshot,
  "damageDisputeWindow" | "depositDisputeWindowDays"
>): DamageDisputeWindowConfig => {
  if (isDamageDisputeWindowConfig(damageDisputeWindow)) {
    return { ...damageDisputeWindow };
  }

  if (
    Number.isInteger(depositDisputeWindowDays) &&
    Number(depositDisputeWindowDays) >= 1 &&
    Number(depositDisputeWindowDays) <= MAX_DAMAGE_DISPUTE_WINDOW_DAYS
  ) {
    return {
      duration: Number(depositDisputeWindowDays),
      unit: "days",
    };
  }

  return { ...DEFAULT_DAMAGE_DISPUTE_WINDOW };
};

export const calculateDamageDisputeDeadline = (
  rentalEndAt: Date,
  window: DamageDisputeWindowConfig
): Date => {
  const hours = window.unit === "days" ? window.duration * 24 : window.duration;
  return new Date(rentalEndAt.getTime() + hours * 60 * 60 * 1000);
};

export const isDamageDisputeBookingComplete = (
  booking: Pick<DamageDisputeBookingSnapshot, "status" | "cancelledFromStatus">
): boolean =>
  booking.status === "completed" ||
  (booking.status === "booking_cancelled" &&
    booking.cancelledFromStatus === "in_progress");

/** Half-open interval: submission is allowed while now < deadline. */
export const evaluateDamageDisputeEligibility = (
  booking: DamageDisputeBookingSnapshot,
  checkedAt: Date
): DamageDisputeEligibility => {
  const window = resolveDamageDisputeWindow(booking);
  const rentalEndAt = booking.returnVerifiedAt
    ? new Date(booking.returnVerifiedAt)
    : null;

  if (!isDamageDisputeBookingComplete(booking)) {
    return {
      eligible: false,
      state: "wrong_status",
      checkedAt,
      rentalEndAt,
      deadlineAt: rentalEndAt
        ? calculateDamageDisputeDeadline(rentalEndAt, window)
        : null,
      window,
    };
  }

  if (!rentalEndAt || Number.isNaN(rentalEndAt.getTime())) {
    return {
      eligible: false,
      state: "not_returned",
      checkedAt,
      rentalEndAt: null,
      deadlineAt: null,
      window,
    };
  }

  const deadlineAt = calculateDamageDisputeDeadline(rentalEndAt, window);

  if (booking.damageDisputeId) {
    return {
      eligible: false,
      state: "already_submitted",
      checkedAt,
      rentalEndAt,
      deadlineAt,
      window,
    };
  }

  const eligible = checkedAt.getTime() < deadlineAt.getTime();
  return {
    eligible,
    state: eligible ? "open" : "expired",
    checkedAt,
    rentalEndAt,
    deadlineAt,
    window,
  };
};
