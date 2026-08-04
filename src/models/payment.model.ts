import mongoose, { Schema, Document } from "mongoose";

export interface IPayment extends Document {
  bookingId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  type: "booking" | "extension" | "damage" | "payout";
  status:
    | "requires_payment"
    | "held"
    | "captured"
    | "cancelled"
    | "refunded"
    | "partially_refunded"
    | "payout_pending"
    | "paid_out"
    | "failed";
  paymentIntentId?: string;
  refundId?: string;
  transferId?: string;
  payoutId?: string;
  capturedAt?: Date;
  refundedAt?: Date;
  payoutAvailableAt?: Date;
  paidOutAt?: Date;
  method: string;
  createdAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    type: {
      type: String,
      enum: ["booking", "extension", "damage", "payout"],
      default: "booking",
    },
    status: {
      type: String,
      enum: [
        "requires_payment",
        "held",
        "captured",
        "cancelled",
        "refunded",
        "partially_refunded",
        "payout_pending",
        "paid_out",
        "failed",
      ],
      default: "requires_payment",
    },
    paymentIntentId: { type: String },
    refundId: { type: String },
    transferId: { type: String },
    payoutId: { type: String },
    capturedAt: { type: Date },
    refundedAt: { type: Date },
    payoutAvailableAt: { type: Date },
    paidOutAt: { type: Date },
    method: { type: String, default: "stripe" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Payment = mongoose.model<IPayment>("Payment", PaymentSchema);
