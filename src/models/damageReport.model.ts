import mongoose, { Schema, Document, model } from "mongoose";

export interface IDamageReport extends Document {
  booking: mongoose.Types.ObjectId;
  rentalText: string;
  issueType: string;
  additionalFees: number;
  attachments: string[];
  user: mongoose.Types.ObjectId;
  status: "pending" | "resolved";
}

const DamageReportSchema = new Schema<IDamageReport>(
  {
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    rentalText: {
      type: String,
      required: true,
    },
    issueType: {
      type: String,
      required: true,
    },
    additionalFees: {
      type: Number,
      required: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "resolved"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export const DamageReport = model<IDamageReport>(
  "DamageReport",
  DamageReportSchema
);
