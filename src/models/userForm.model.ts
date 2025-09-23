import mongoose, { Schema, Document } from "mongoose";

export interface IForm extends Document {
  zone: mongoose.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  fields: mongoose.Types.ObjectId[];
  type: "listing" | "user";
}

const FormSchema = new Schema<IForm>(
  {
    zone: { type: Schema.Types.ObjectId, ref: "Zone", required: true },
    subCategory: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    fields: [{ type: Schema.Types.ObjectId, ref: "Field" }],
    type: { type: String, enum: ["listing", "user"], default: "user" },
  },
  { timestamps: true }
);

export const UserForm = mongoose.model<IForm>("UserForm", FormSchema);
