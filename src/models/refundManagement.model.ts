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
      
    },
    reason: {
      type: String,
      
    },
    deduction: {
      type: Number,
      default: 0,
    },
    totalRefundAmount: {
      type: Number,
      
    },
    card: {
      type: String,
      enum: ["MasterCard", "Visa", "DebitCard"],
      
    },
    cardDetails: {
      cardNumber: { type: String, },
      cardHolderName: { type: String, },
      expiry: { type: String, },
      cvvCode: { type: String, },
    },
    profile: {
      name: { type: String, },
      dob: { type: Date, },
      nationality: { type: String, },
    },
    idVerification: {
      documentType: { type: String, },
      expiryDate: { type: Date, },
      documentUpload: { type: String, }, 
    },
    businessVerification: {
      taxId: { type: String, },
      expiryDate: { type: Date, },
      businessLicense: { type: String, }, 
    },
    selectTime: {
      type: String,
    },
    zone: {
      type: Schema.Types.ObjectId,
      ref: "Zone",
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "Category",
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
