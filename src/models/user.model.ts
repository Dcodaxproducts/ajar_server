// src/models/user.model.ts
import mongoose, { Schema, Document } from "mongoose";

// Sub-schema for document images
export interface IDocumentImage {
  side: "front" | "back" | "single"; // "single" for docs like passport
  url: string;
}

//  Sub-schema for a document
export interface IDocument {
  images: IDocumentImage[];
  status: "pending" | "approved" | "rejected";
  reason?: string; // Only if rejected
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
    resetToken: string;
    resetTokenExpiry: Date;
  };
  status: "active" | "inactive" | "blocked" | "unblocked";

  //  Added documents inside user
  documents: {
    cnic?: IDocument;
    passport?: IDocument;
    driving_license?: IDocument;
  };
}

// ✅ Sub-schema for document image
const DocumentImageSchema = new Schema<IDocumentImage>(
  {
    side: { type: String, enum: ["front", "back", "single"], required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

// ✅ Sub-schema for document
const DocumentSchema = new Schema<IDocument>(
  {
    images: { type: [DocumentImageSchema], required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reason: { type: String },
  },
  { _id: false }
);

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

    // ✅ Documents added here
    documents: {
      cnic: { type: DocumentSchema, default: null },
      passport: { type: DocumentSchema, default: null },
      driving_license: { type: DocumentSchema, default: null },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);

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
//   status: "active" | "inactive" | "blocked" | "Unblocked";
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
//   },
//   { timestamps: true }
// );

// export const User = mongoose.model<IUser>("User", UserSchema);
