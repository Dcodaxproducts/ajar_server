import mongoose, { Schema, Document } from "mongoose";

export interface IRefundPolicy extends Document {
  zone: mongoose.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  allowFund: boolean;
  cancellationCutoffTime: {
    days: number;
    hours: number;
  };
  flatFee: {
    amount: { type: Number; default: 0 };
    days: { type: Number; default: 0 };
    hours: { type: Number; default: 0 };
  };
  noteText: string;
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
    cancellationCutoffTime: {
      days: { type: Number, default: 0 },
      hours: { type: Number, default: 0 },
    },
    flatFee: {
      amount: { type: Number, default: 0 },
      days: { type: Number, default: 0 },
      hours: { type: Number, default: 0 },
    },
    noteText: String,
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
