import mongoose, { Schema, Document } from "mongoose";

// One entry per booking being refunded. An early return covers the parent
// booking plus each extension, and every one has its own Stripe PaymentIntent.
export interface IRefundBreakdownLine {
  booking: mongoose.Types.ObjectId;
  isExtension: boolean;
  price: number;
  deductedAmount: number;
  refundAmount: number;
  refundedAt?: Date;
}

export interface IRefundRequest extends Document {
  booking: mongoose.Types.ObjectId;
  reason: string;
  user: mongoose.Types.ObjectId;
  deduction: number;
  totalRefundAmount: number;
  policy: mongoose.Types.ObjectId;
  status: "pending" | "accept" | "reject";
  note: string;
  securityDeposit: number;
  isEarlyReturn: boolean;
  breakdown: IRefundBreakdownLine[];
}

const refundBreakdownSchema = new Schema<IRefundBreakdownLine>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    isExtension: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    deductedAmount: { type: Number, default: 0 },
    refundAmount: { type: Number, default: 0 },
    // Stamped as soon as Stripe confirms, so a retry never double-refunds
    refundedAt: { type: Date },
  },
  { _id: false }
);

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
    securityDeposit: Number,
    status: {
      type: String,
      enum: ["pending", "accept", "reject"],
      default: "pending",
    },
    note: String,
    isEarlyReturn: { type: Boolean, default: false },
    breakdown: { type: [refundBreakdownSchema], default: [] },
  },
  { timestamps: true }
);

export const RefundRequest = mongoose.model<IRefundRequest>(
  "RefundRequest",
  refundRequestSchema
);
