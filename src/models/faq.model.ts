import mongoose, { Schema, Document } from "mongoose";

interface LanguageTranslation {
  locale: string;
  translations: {
    question?: string;
    answer?: string;
  };
}

export interface IFAQ extends Document {
  question: string;
  answer: string;
  order: number;
  languages: LanguageTranslation[];
}

const faqSchema = new Schema<IFAQ>(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    order: { type: Number, required: true },
    languages: [
      {
        locale: { type: String, required: true },
        translations: {
          question: String,
          answer: String,
        },
      },
    ],
  },
  { timestamps: true }
);

export const FAQ = mongoose.model<IFAQ>("FAQ", faqSchema);
