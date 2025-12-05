import mongoose, { Schema, Document } from "mongoose";

export interface IArticle extends Document {
  title: string;
  description: string;
  images: string[];
  createdAt: Date;
}

const ArticleSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

export const Article = mongoose.model<IArticle>("Article", ArticleSchema);
