import mongoose, { Schema, Document } from "mongoose";

export interface IRentRequest extends Document {
  submission: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  bookingDates: Date[];
  payment: {
    status: "pending" | "paid" | "failed";
    paymentIntent: string;
    amount: number;
  };
}

const RentRequestSchema: Schema = new Schema(
  {
    submission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    bookingDates: {
      type: [Date],
      required: true,
    },
    payment: {
      status: {
        type: String,
        enum: ["pending", "paid", "failed"],
        default: "pending",
      },
      paymentIntent: {
        type: String,
        required: true,
      },
      amount: {
        type: Number,
        required: true,
        min: 0,
      },
    },
  },
  { timestamps: true }
);

export const RentRequest = mongoose.model<IRentRequest>(
  "RentRequest",
  RentRequestSchema
);
