import mongoose, { Schema, Document, model } from "mongoose";

export interface IDamageReport extends Document {
  bookingId: mongoose.Types.ObjectId;
  rentalText: string;
  issueType: string;
  additionalFees: number;
  attachments: string[]; 
}

const DamageReportSchema = new Schema<IDamageReport>(
  {
    bookingId: {
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
  },
  { timestamps: true }
);

export const DamageReport = model<IDamageReport>("DamageReport", DamageReportSchema);
