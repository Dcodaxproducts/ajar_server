import mongoose, { Schema, Document, model } from "mongoose";

export interface IDamageReport extends Document {
  booking: mongoose.Types.ObjectId;
  rentalText: string;
  issueType: string;
  damagedCharges: number;
  attachments: string[];
  user: mongoose.Types.ObjectId;
  status: "pending" | "processing" | "approved" | "partially_approved" | "rejected";
  // What the admin actually authorised — can be lower than damagedCharges
  approvedAmount?: number;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  adminNote?: string;
  currency: string;
  version: number;
  decisionIdempotencyKey?: string;
  decisionEvidence: string[];
  decisionAudit: Array<{
    action: "approved" | "rejected";
    actor: mongoose.Types.ObjectId;
    at: Date;
    reason: string;
    claimedAmount: number;
    approvedAmount: number;
    currency: string;
    evidence: string[];
    version: number;
    idempotencyKey: string;
  }>;
}

const DamageReportSchema = new Schema<IDamageReport>(
  {
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    rentalText: {
      type: String,
      required: true,
    },
    issueType: {
      type: String,
      required: true,
    },
    damagedCharges: {
      type: Number,
      required: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "approved", "partially_approved", "rejected"],
      default: "pending",
    },
    approvedAmount: {
      type: Number,
      min: 0,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: {
      type: Date,
    },
    adminNote: {
      type: String,
      default: "",
    },
    currency: {
      type: String,
      enum: ["USD"],
      default: "USD",
      required: true,
    },
    version: {
      type: Number,
      min: 0,
      default: 0,
      required: true,
    },
    decisionIdempotencyKey: { type: String },
    decisionEvidence: { type: [String], default: [] },
    decisionAudit: {
      type: [
        {
          action: { type: String, enum: ["approved", "rejected"], required: true },
          actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
          at: { type: Date, required: true },
          reason: { type: String, required: true },
          claimedAmount: { type: Number, required: true, min: 0 },
          approvedAmount: { type: Number, required: true, min: 0 },
          currency: { type: String, enum: ["USD"], required: true },
          evidence: { type: [String], default: [] },
          version: { type: Number, required: true, min: 1 },
          idempotencyKey: { type: String, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// One dispute per booking. This is the final concurrency invariant even when
// simultaneous requests pass the same eligibility read.
DamageReportSchema.index({ booking: 1 }, { unique: true });
DamageReportSchema.index({ status: 1, createdAt: -1 });
DamageReportSchema.index({ decisionIdempotencyKey: 1 }, { sparse: true });

export const DamageReport = model<IDamageReport>(
  "DamageReport",
  DamageReportSchema
);
