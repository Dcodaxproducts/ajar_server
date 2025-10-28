import mongoose, { Schema, Document } from "mongoose";
import { string } from "zod";

export interface IUserDocument {
  name: string;         // e.g. "cnic", "driving_license"
  filesUrl: string[];      // uploaded file link (S3/Firebase)
  expiryDate?: Date;    // optional
  status?: "pending" | "approved" | "rejected";
  reason?: string;     // reason for rejection if any
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
  dob: Date;
  nationality: string;
  profilePicture: string;
  phone: string;
  stripe: {
    customerId: string;
    subscriptionId: string;
    connectedAccountId: string;
    connectedAccountLink: string;
  };
    otp: {
    isVerified: boolean;
    code: string;
    expiry: Date;
  };
  status: "active" | "inactive" | "blocked" | "unblocked";
  documents: IUserDocument[];
}

const UserDocumentSchema = new Schema<IUserDocument>({
  name: { type: String, required: true },
  filesUrl: [{ type: String, required: true }],
  expiryDate: { type: Date },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  reason: { type: String }, // reason for rejection if any
});

const UserSchema: Schema<IUser> = new Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
 otp: {
      isVerified: { type: Boolean, default: false },
      code: { type: String, default: "" },
      expiry: { type: Date, default: null },
    },
    stripe: {
      customerId: { type: String },
      subscriptionId: { type: String },
      connectedAccountId: { type: String, default: "" },
      connectedAccountLink: { type: String, default: "" },
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    dob: { type: Date },
    nationality: { type: String },
    profilePicture: { type: String, default: "" },
    phone: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "unblocked"],
      default: "active",
    },
    documents: [UserDocumentSchema], // embedded user verification docs
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
