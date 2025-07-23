import mongoose, { Schema, Document } from "mongoose";

export interface IRefundManagement extends Document {
  booking: mongoose.Types.ObjectId;
  reason: string;
  deduction: number;
  totalRefundAmount: number;
  card: "MasterCard" | "Visa" | "DebitCard";
  cardDetails: {
    cardNumber: string;
    cardHolderName: string;
    expiry: string;
    cvvCode: string;
  };
  profile: {
    name: string;
    dob: Date;
    nationality: string;
  };
  idVerification: {
    documentType: string;
    expiryDate: Date;
    documentUpload: string;
  };
  businessVerification: {
    taxId: string;
    expiryDate: Date;
    businessLicense: string;
  };
  selectTime: string;
  zone: mongoose.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  allowFund: boolean;
  cutoffTime: {
    days: number;
    hours: number;
  };
  flatFee: number;
  time: {
    days: number;
    hours: number;
  };
  note: string;
}

const refundManagementSchema = new Schema<IRefundManagement>(
  {
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    deduction: {
      type: Number,
      default: 0,
    },
    totalRefundAmount: {
      type: Number,
      required: true,
    },
    card: {
      type: String,
      enum: ["MasterCard", "Visa", "DebitCard"],
      required: true,
    },
    cardDetails: {
      cardNumber: { type: String, required: true },
      cardHolderName: { type: String, required: true },
      expiry: { type: String, required: true },
      cvvCode: { type: String, required: true },
    },
    profile: {
      name: { type: String, required: true },
      dob: { type: Date, required: true },
      nationality: { type: String, required: true },
    },
    idVerification: {
      documentType: { type: String, required: true },
      expiryDate: { type: Date, required: true },
      documentUpload: { type: String, required: true }, // file URL or path
    },
    businessVerification: {
      taxId: { type: String, required: true },
      expiryDate: { type: Date, required: true },
      businessLicense: { type: String, required: true }, // file URL or path
    },
    selectTime: {
      type: String,
      required: true,
    },
    zone: {
      type: Schema.Types.ObjectId,
      ref: "Zone",
      required: true,
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    allowFund: {
      type: Boolean,
      default: false,
    },
    cutoffTime: {
      days: { type: Number, default: 0 },
      hours: { type: Number, default: 0 },
    },
    flatFee: {
      type: Number,
      default: 0,
    },
    time: {
      days: { type: Number, default: 0 },
      hours: { type: Number, default: 0 },
    },
    note: {
      type: String,
    },
  },
  { timestamps: true }
);

export const RefundManagement = mongoose.model<IRefundManagement>(
  "RefundManagement",
  refundManagementSchema
);
