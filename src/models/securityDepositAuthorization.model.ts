import mongoose, { Document, Schema, model } from "mongoose";

export const SECURITY_DEPOSIT_STATES = [
  "AUTHORIZED_HELD",
  "RELEASE_SCHEDULED",
  "RELEASE_IN_PROGRESS",
  "DISPUTE_OPEN",
  "SETTLEMENT_SCHEDULED",
  "SETTLEMENT_IN_PROGRESS",
  "RELEASED_NO_DISPUTE",
  "ADMIN_REJECTED_RELEASED",
  "ADMIN_APPROVED_CAPTURED",
  "ADMIN_APPROVED_PARTIALLY_CAPTURED",
  "EXPIRED",
  "PROVIDER_ACTION_REQUIRED",
  "FAILED_RETRYABLE",
] as const;

export type SecurityDepositState = (typeof SECURITY_DEPOSIT_STATES)[number];
export type SecurityDepositAction = "release" | "capture" | null;

export interface ISecurityDepositAuthorization extends Document {
  bookingId: mongoose.Types.ObjectId;
  renterId: mongoose.Types.ObjectId;
  disputeId?: mongoose.Types.ObjectId;
  provider: "stripe";
  providerPaymentIntentId: string;
  amountAuthorized: number;
  amountCapturable: number;
  amountCaptured: number;
  currency: string;
  state: SecurityDepositState;
  providerStatus?: string;
  captureBefore: Date;
  disputeDeadline?: Date;
  nextActionAt: Date;
  nextAction: SecurityDepositAction;
  approvedAmount?: number;
  attempts: number;
  lastErrorCode?: string;
  leaseUntil?: Date;
  version: number;
  releaseIdempotencyKey: string;
  captureIdempotencyKey: string;
  notificationKeys: string[];
  audit: Array<{
    event: string;
    at: Date;
    fromState?: string;
    toState: string;
    amount?: number;
    idempotencyKey?: string;
  }>;
}

const SecurityDepositAuthorizationSchema = new Schema<ISecurityDepositAuthorization>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    renterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    disputeId: { type: Schema.Types.ObjectId, ref: "DamageReport" },
    provider: { type: String, enum: ["stripe"], default: "stripe", required: true },
    providerPaymentIntentId: { type: String, required: true },
    amountAuthorized: { type: Number, required: true, min: 1 },
    amountCapturable: { type: Number, required: true, min: 0 },
    amountCaptured: { type: Number, default: 0, min: 0 },
    currency: { type: String, required: true, lowercase: true },
    state: { type: String, enum: SECURITY_DEPOSIT_STATES, required: true },
    providerStatus: { type: String },
    captureBefore: { type: Date, required: true },
    disputeDeadline: { type: Date },
    nextActionAt: { type: Date, required: true },
    nextAction: { type: String, enum: ["release", "capture", null], default: null },
    approvedAmount: { type: Number, min: 0 },
    attempts: { type: Number, default: 0, min: 0 },
    lastErrorCode: { type: String },
    leaseUntil: { type: Date },
    version: { type: Number, default: 0, min: 0 },
    releaseIdempotencyKey: { type: String, required: true },
    captureIdempotencyKey: { type: String, required: true },
    notificationKeys: { type: [String], default: [] },
    audit: {
      type: [{
        event: { type: String, required: true },
        at: { type: Date, required: true },
        fromState: { type: String },
        toState: { type: String, required: true },
        amount: { type: Number },
        idempotencyKey: { type: String },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

SecurityDepositAuthorizationSchema.index({ bookingId: 1 }, { unique: true });
SecurityDepositAuthorizationSchema.index({ providerPaymentIntentId: 1 }, { unique: true });
SecurityDepositAuthorizationSchema.index({ state: 1, nextActionAt: 1, leaseUntil: 1 });
SecurityDepositAuthorizationSchema.index({ disputeId: 1 }, { sparse: true });

export const SecurityDepositAuthorization = model<ISecurityDepositAuthorization>(
  "SecurityDepositAuthorization",
  SecurityDepositAuthorizationSchema
);
