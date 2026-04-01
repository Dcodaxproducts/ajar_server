import mongoose, { Schema, Document } from "mongoose";

export interface ICancellationTier {
  daysBeforeCheckIn: number;  // tier applies when days remaining >= this
  percentage: number;         // 0–100: portion of booking price to DEDUCT
  label?: string;             // shown on receipts/UI e.g. "Early cancellation"
}

export interface IRefundPolicy extends Document {
  zone: mongoose.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  allowRefund: boolean;
  tiers: ICancellationTier[];
  noteText?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cancellationTierSchema = new Schema<ICancellationTier>(
  {
    daysBeforeCheckIn: { type: Number, required: true, min: 0 },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    label: { type: String },
  },
  { _id: false }
);

const refundPolicySchema = new Schema<IRefundPolicy>(
  {
    zone: { type: Schema.Types.ObjectId, ref: "Zone", required: true },
    subCategory: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    allowRefund: { type: Boolean, default: false },
    tiers: {
      type: [cancellationTierSchema],
      default: [],
      validate: {
        validator(tiers: ICancellationTier[]) {
          const days = tiers.map((t) => t.daysBeforeCheckIn);
          return days.length === new Set(days).size;
        },
        message: "Duplicate daysBeforeCheckIn values in tiers",
      },
    },
    noteText: { type: String },
  },
  { timestamps: true }
);

// one policy per zone+subCategory combination
refundPolicySchema.index({ zone: 1, subCategory: 1 }, { unique: true });

export const RefundPolicy = mongoose.model<IRefundPolicy>(
  "RefundPolicy",
  refundPolicySchema
);