import mongoose, { Schema, Document } from "mongoose";

export interface IWalletTransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: "credit" | "debit";
  amount: number;
  source: "stripe" | "booking" | "refund" | "withdraw" | string;
  bankAccountId: mongoose.Types.ObjectId; // Refers to user's bank account
  status: "pending" | "approved" | "rejected";
  description?: string;
  createdAt: Date;
  requestedAt: Date;
  processedAt?: Date;
}

const WalletTransactionSchema = new Schema<IWalletTransaction>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["credit", "debit", "withdraw"], required: true },
  amount: { type: Number, required: true },
  bankAccountId: { type: Schema.Types.ObjectId, required: false },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  source: { type: String, required: true },
  description: { type: String },
  createdAt: { type: Date, default: Date.now },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
});

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  "WalletTransaction",
  WalletTransactionSchema
);
