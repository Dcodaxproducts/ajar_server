import mongoose, { Schema, Document } from "mongoose";

export interface IContactUs extends Document {
  phone: string;
  email: string;
  address: string;
  order: number;
}

const contactUsSchema: Schema = new Schema(
  {
    phone: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const ContactUs = mongoose.model<IContactUs>("ContactUs", contactUsSchema);
