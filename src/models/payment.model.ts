import mongoose, { Schema, Document } from "mongoose";

export interface IPayment extends Document {
  bookingId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  paymentIntentId: string;
  method: string;
  createdAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    status: { type: String, enum: ["pending", "succeeded", "failed"], default: "pending" },
    paymentIntentId: { type: String, required: true },
    method: { type: String, default: "stripe" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Payment = mongoose.model<IPayment>("Payment", PaymentSchema);
