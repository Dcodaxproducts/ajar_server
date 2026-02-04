import mongoose, { Schema, Document } from "mongoose";

export interface IRefundRequest extends Document {
  booking: mongoose.Types.ObjectId;
  reason: string;
  user: mongoose.Types.ObjectId;
  deduction: number;
  totalRefundAmount: number;
  policy: mongoose.Types.ObjectId;
  status: "pending" | "accept" | "reject";
  note: string;
}

const refundRequestSchema = new Schema<IRefundRequest>(
  {
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    reason: String,
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    deduction: {
      type: Number,
      default: 0,
    },
    totalRefundAmount: Number,
    policy: {
      type: Schema.Types.ObjectId,
      ref: "RefundPolicy",
    },
    status: {
      type: String,
      enum: ["pending", "accept", "reject"],
      default: "pending",
    },
    note: String,
  },
  { timestamps: true }
);

export const RefundRequest = mongoose.model<IRefundRequest>(
  "RefundRequest",
  refundRequestSchema
);
