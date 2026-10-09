import mongoose, { Schema, Document } from "mongoose";

// Applies before the rental starts — cancelling an approved booking
export interface ICancellationTier {
  hoursBeforeCheckIn: number;
  /** Transitional read compatibility only; new API writes are normalized to hours. */
  daysBeforeCheckIn?: number;
  percentage: number;         // 0–100: portion of booking price to DEDUCT
  label?: string;             // shown on receipts/UI e.g. "Early cancellation"
}

// Applies once the rental is running — renter returns the item early
export interface IEarlyReturnTier {
  hoursBeforeCheckOut: number;
  percentage: number;
  label?: string;
}

export interface IRefundPolicy extends Document {
  zone: mongoose.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  allowRefund: boolean;
  tiers: ICancellationTier[];
  earlyReturnTiers: IEarlyReturnTier[];
  noteText?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cancellationTierSchema = new Schema<ICancellationTier>(
  {
    hoursBeforeCheckIn: {
      type: Number,
      required: function (this: ICancellationTier) {
        return this.daysBeforeCheckIn === undefined;
      },
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "hoursBeforeCheckIn must be a whole number",
      },
    },
    // Retained only so pre-migration documents can be read and converted safely.
    daysBeforeCheckIn: {
      type: Number,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "daysBeforeCheckIn must be a whole number",
      },
    },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    label: { type: String },
  },
  { _id: false }
);

const canonicalizeCancellationTier = (
  _document: unknown,
  returned: Record<string, unknown>
): Record<string, unknown> => {
  if (
    returned.hoursBeforeCheckIn === undefined &&
    typeof returned.daysBeforeCheckIn === "number"
  ) {
    returned.hoursBeforeCheckIn = returned.daysBeforeCheckIn * 24;
  }
  delete returned.daysBeforeCheckIn;
  return returned;
};

cancellationTierSchema.set("toJSON", { transform: canonicalizeCancellationTier });
cancellationTierSchema.set("toObject", { transform: canonicalizeCancellationTier });

const earlyReturnTierSchema = new Schema<IEarlyReturnTier>(
  {
    hoursBeforeCheckOut: { type: Number, required: true, min: 0 },
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
          const hours = tiers.map((t) => t.hoursBeforeCheckIn);
          return hours.length === new Set(hours).size;
        },
        message: "Duplicate hoursBeforeCheckIn values in tiers",
      },
    },
    earlyReturnTiers: {
      type: [earlyReturnTierSchema],
      default: [],
      validate: {
        validator(tiers: IEarlyReturnTier[]) {
          const hours = tiers.map((t) => t.hoursBeforeCheckOut);
          return hours.length === new Set(hours).size;
        },
        message: "Duplicate hoursBeforeCheckOut values in earlyReturnTiers",
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
