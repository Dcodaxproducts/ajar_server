import type Stripe from "stripe";
import type { SecurityDepositState } from "../models/securityDepositAuthorization.model";
import {
  calculateDamageDisputeDeadline,
  resolveDamageDisputeWindow,
} from "./damageDisputeWindow.service";

export const AUTHORIZATION_SAFETY_MARGIN_MS = 60 * 60 * 1000;

export const sanitizeProviderErrorCode = (error: unknown): string => {
  const candidate = error as { code?: unknown; type?: unknown };
  const raw = typeof candidate?.code === "string"
    ? candidate.code
    : typeof candidate?.type === "string"
      ? candidate.type
      : "provider_error";
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
};

export const extractCaptureBefore = (
  intent: Stripe.PaymentIntent
): Date | null => {
  const charge = typeof intent.latest_charge === "object"
    ? intent.latest_charge
    : null;
  const timestamp = charge?.payment_method_details?.card?.capture_before;
  return typeof timestamp === "number" ? new Date(timestamp * 1000) : null;
};

export const supportsDisputeDeadline = (
  deadline: Date,
  captureBefore: Date,
  margin = AUTHORIZATION_SAFETY_MARGIN_MS
): boolean => deadline.getTime() <= captureBefore.getTime() - margin;

export const providerAuthorizationUpperBound = (
  authorizedAt = new Date()
): Date => {
  const configured = Number(
    process.env.STRIPE_CARD_AUTHORIZATION_MAX_HOURS || 168
  );
  const hours = Number.isFinite(configured) && configured > 1
    ? Math.min(configured, 720)
    : 168;
  return new Date(authorizedAt.getTime() + hours * 60 * 60 * 1000);
};

export const assertProjectedAuthorizationWindow = (
  booking: {
    dates: { checkOut: Date };
    damageDisputeWindow?: unknown;
    depositDisputeWindowDays?: unknown;
  },
  authorizedAt = new Date()
) => {
  const deadline = calculateDamageDisputeDeadline(
    booking.dates.checkOut,
    resolveDamageDisputeWindow(booking)
  );
  if (!supportsDisputeDeadline(
    deadline,
    providerAuthorizationUpperBound(authorizedAt)
  )) {
    throw Object.assign(
      new Error("DEPOSIT_AUTHORIZATION_WINDOW_UNSUPPORTED"),
      { code: "DEPOSIT_AUTHORIZATION_WINDOW_UNSUPPORTED" }
    );
  }
  return deadline;
};

export const resolveDepositFundingMode = (
  providerStatus: string,
  captureBefore: Date | null,
  disputeDeadline: Date
): "authorization_hold" | "captured_refundable" =>
  providerStatus === "requires_capture" &&
  captureBefore !== null &&
  supportsDisputeDeadline(disputeDeadline, captureBefore)
    ? "authorization_hold"
    : "captured_refundable";

export const resolveFallbackRefundAmount = (
  approvedAmount: number | null,
  authorizedAmount: number
): number => {
  if (!Number.isSafeInteger(authorizedAmount) || authorizedAmount <= 0) {
    throw new Error("DEPOSIT_AUTHORIZED_AMOUNT_INVALID");
  }
  if (approvedAmount === null) return authorizedAmount;
  if (!Number.isSafeInteger(approvedAmount) || approvedAmount < 0 || approvedAmount > authorizedAmount) {
    throw new Error("DEPOSIT_APPROVED_AMOUNT_INVALID");
  }
  return authorizedAmount - approvedAmount;
};

export const resolveCaptureTerminalState = (
  captured: number,
  authorized: number
): SecurityDepositState => {
  if (
    !Number.isSafeInteger(captured) ||
    !Number.isSafeInteger(authorized) ||
    captured <= 0 ||
    captured > authorized
  ) {
    throw new Error("DEPOSIT_CAPTURE_AMOUNT_INVALID");
  }
  return captured === authorized
    ? "ADMIN_APPROVED_CAPTURED"
    : "ADMIN_APPROVED_PARTIALLY_CAPTURED";
};

export const depositActionKeys = (bookingId: string) => ({
  release: "deposit-release-" + bookingId + "-v1",
  capture: "deposit-capture-" + bookingId + "-v1",
  fallbackCapture: "deposit-fallback-capture-" + bookingId + "-v1",
  refund: "deposit-refund-" + bookingId + "-v1",
});
