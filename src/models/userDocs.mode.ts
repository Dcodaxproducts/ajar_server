import mongoose, { Document, Schema } from "mongoose";

interface IUserDocument extends Document {
  user: mongoose.Types.ObjectId;
  category: mongoose.Types.ObjectId;
  fieldName: string;
  value: string;
  type: "file" | "text";
  createdAt: Date;
  updatedAt: Date;
}

const UserDocumentSchema = new Schema<IUserDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    fieldName: { type: String, required: true },
    value: { type: String, required: true },
    type: { type: String, enum: ["file", "text"], required: true },
  },
  { timestamps: true }
);

UserDocumentSchema.index(
  { user: 1, category: 1, fieldName: 1 },
  { unique: true }
);

const UserDocument = mongoose.model<IUserDocument>(
  "UserDocument",
  UserDocumentSchema
);

export { UserDocument, IUserDocument };
