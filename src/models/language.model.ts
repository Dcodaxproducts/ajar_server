import mongoose, { Schema, Document } from "mongoose";

export interface ILanguage extends Document {
  title: string;
  key: string;
  isRtl: boolean;
  isDefault: boolean;
}

const languageSchema: Schema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    isRtl: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Language = mongoose.model<ILanguage>("Language", languageSchema);
