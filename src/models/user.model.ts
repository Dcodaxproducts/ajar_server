import mongoose, { Schema, Document, Types } from "mongoose";
import { IUserDocument } from "./userDocs.model"; // optional, if you want to type populated documents

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
  status: "active" | "inactive" | "blocked" | "unblocked";

  // 🔹 Only add this line
  documents: Types.ObjectId[] | IUserDocument[];
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
      enum: ["active", "inactive", "blocked", "unblocked"],
      default: "active",
    },
    documents: [{ type: Schema.Types.ObjectId, ref: "UserDocument" }],
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);








// // src/models/user.model.ts
// import mongoose, { Schema, Document } from "mongoose";

// export interface IUser extends Document {
//   name: string;
//   email: string;
//   password: string;
//   role: "user" | "admin";
//   dob: Date;
//   nationality: string;
//   profilePicture: string;
//   phone: string;
//   stripe: {
//     customerId: string;
//     subscriptionId: string;
//     connectedAccountId: string;
//     connectedAccountLink: string;
//   };
//   otp: {
//     isVerified: boolean;
//     code: string;
//     expiry: Date;
//     resetToken: string;
//     resetTokenExpiry: Date;
//   };
//   status: "active" | "inactive" | "blocked" | "unblocked";
  


// }



// const UserSchema: Schema = new Schema(
//   {
//     name: { type: String, trim: true },
//     email: {
//       type: String,
//       required: true,
//       unique: true,
//       lowercase: true,
//       index: true,
//     },
//     otp: {
//       isVerified: { type: Boolean, default: false },
//       code: { type: String },
//       expiry: { type: Date },
//       resetToken: { type: String },
//       resetTokenExpiry: { type: Date },
//     },
//     stripe: {
//       customerId: { type: String },
//       subscriptionId: { type: String },
//       connectedAccountId: { type: String, default: "" },
//       connectedAccountLink: { type: String, default: "" },
//     },
//     password: { type: String, required: true },
//     role: {
//       type: String,
//       enum: ["user", "admin"],
//       default: "user",
//     },
//     dob: { type: Date },
//     nationality: { type: String },
//     profilePicture: { type: String, default: "" },
//     phone: { type: String, default: "" },
//     status: {
//       type: String,
//       enum: ["active", "inactive", "blocked", "unblocked"],
//       default: "active",
//     },
//     documents: [{ type: Schema.Types.ObjectId, ref: "UserDocument" }], // 🔹 added
//   },
//   { timestamps: true }
// );

// export const User = mongoose.model<IUser>("User", UserSchema);
