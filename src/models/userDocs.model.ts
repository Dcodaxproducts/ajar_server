import mongoose, { Schema, Document } from "mongoose";

interface DocumentItem {
  name: string;           // "Passport", "CNIC" (from documentConfig)
  expiryDate?: Date;
  image?: string;
  status: "pending" | "approved" | "rejected";
}

export interface IUserDocument extends Document {
  user: mongoose.Types.ObjectId;
  field: mongoose.Types.ObjectId;
  values: DocumentItem[];   // array instead of single object
}

const UserDocumentSchema = new Schema<IUserDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    field: { type: Schema.Types.ObjectId, ref: "Field", required: true },
    values: [
      {
        name: { type: String, required: true },
        expiryDate: { type: Date },
        image: { type: String },
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
      }
    ],
  },
  { timestamps: true }
);

export const UserDocument = mongoose.model<IUserDocument>(
  "UserDocument",
  UserDocumentSchema
);
