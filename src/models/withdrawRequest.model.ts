import mongoose, { Schema, Document } from "mongoose";

export interface IWithdrawRequest extends Document {
  userId: mongoose.Types.ObjectId;
  amount: number;
  bankAccountId: mongoose.Types.ObjectId; // Refers to user's bank account
  status: "pending" | "approved" | "rejected";
  reason?: string; // For rejection notes
  requestedAt: Date;
  processedAt?: Date;
}

const WithdrawRequestSchema = new Schema<IWithdrawRequest>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  bankAccountId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  reason: { type: String },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
});

export const WithdrawRequest = mongoose.model<IWithdrawRequest>(
  "WithdrawRequest",
  WithdrawRequestSchema
);
