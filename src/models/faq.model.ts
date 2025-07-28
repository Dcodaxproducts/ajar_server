import mongoose, { Document, Schema } from "mongoose";

export interface IFaq extends Document {
  question: string;
  answer: string;
  order: number; 
}

const faqSchema = new Schema<IFaq>(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    order: { type: Number, required: true },
  },
  { timestamps: true }
);

export const FAQ = mongoose.model<IFaq>("FAQ", faqSchema);
