import mongoose, { Schema, Document } from "mongoose";

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
    resetToken: string;
    resetTokenExpiry: Date;
  };
  status: "active" | "inactive" | "blocked" | "Unblocked";
}

const UserSchema: Schema = new Schema(
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
      code: { type: String },
      expiry: { type: Date },
      resetToken: { type: String },
      resetTokenExpiry: { type: Date },
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
      enum: ["active", "inactive", "blocked", "Unblocked"],
      default: "active",
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
