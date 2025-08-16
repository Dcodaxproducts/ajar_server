import mongoose, { Schema, Document } from "mongoose";

export interface IRefundPolicy extends Document {
  zone: mongoose.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  allowFund: boolean;
  cutoffTime: {
    days: number;
    hours: number;
  };
  flatFee: number;
  time: {
    days: number;
    hours: number;
  };
  note: string;
  refundWindow: "full" | "partial" | "custom";
}

const refundPolicySchema = new Schema<IRefundPolicy>(
  {
    zone: {
      type: Schema.Types.ObjectId,
      ref: "Zone",
      required: true,
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    allowFund: {
      type: Boolean,
      default: false,
    },
    cutoffTime: {
      days: { type: Number, default: 0 },
      hours: { type: Number, default: 0 },
    },
    flatFee: {
      type: Number,
      default: 0,
    },
    time: {
      days: { type: Number, default: 0 },
      hours: { type: Number, default: 0 },
    },
    note: String,
    refundWindow: {
      type: String,
      enum: ["full", "partial", "custom"],
      default: "full",
    },
  },
  { timestamps: true }
);

export const RefundPolicy = mongoose.model<IRefundPolicy>(
  "RefundPolicy",
  refundPolicySchema
);
