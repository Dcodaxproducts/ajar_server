import mongoose, { Schema, Document } from "mongoose";

export interface ITransaction extends Document {
  user: mongoose.Types.ObjectId;
  connectedAccountId?: string;
  paymentIntentId: string;
  transferId?: string;
  refundId?: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "refunded" | "disputed";
  paymentMethod?: string;
  transactionType: "deposit" | "purchase" | "refund" | "payout";
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // sellerId: { type: Schema.Types.ObjectId, ref: "User" },
    connectedAccountId: { type: String },
    paymentIntentId: { type: String, required: true, unique: true },
    transferId: { type: String },
    refundId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: "usd" },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "refunded", "disputed"],
      required: true,
      default: "pending",
    },
    paymentMethod: { type: String },
    transactionType: {
      type: String,
      default: "purchase",
      enum: ["deposit", "purchase", "refund", "payout"],
    },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  TransactionSchema
);
