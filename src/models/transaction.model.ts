import mongoose, { Schema, Document } from "mongoose";

export type TransactionType = "credit" | "debit";

export type TransactionSource =
  | "booking_payment"
  | "platform_capture"
  | "security_deposit_refund"
  | "leaser_earning"
  | "leaser_payout"
  | "booking_refund"
  | "damage_charge";

export interface ITransaction extends Document {
  paymentId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  amount: number;
  type: TransactionType;
  source: TransactionSource;
  status: "pending" | "succeeded" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    source: {
      type: String,
      enum: [
        "booking_payment",
        "platform_capture",
        "security_deposit_refund",
        "leaser_earning",
        "leaser_payout",
        "booking_refund",
        "damage_charge",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed"],
      default: "succeeded",
    },
  },
  { timestamps: true }
);

TransactionSchema.index({ paymentId: 1, userId: 1, source: 1 });

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  TransactionSchema,
  "ledger_transactions"
);
