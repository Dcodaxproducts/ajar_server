import mongoose, { Schema, Document } from "mongoose";

export interface IWalletTransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: "credit" | "debit";
  amount: number;
  source: "stripe" | "booking" | "refund" | string;
  description?: string;
  createdAt: Date;
}

const WalletTransactionSchema = new Schema<IWalletTransaction>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["credit", "debit"], required: true },
  amount: { type: Number, required: true },
  source: { type: String, required: true },
  description: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  "WalletTransaction",
  WalletTransactionSchema
);
