import mongoose, { Schema, Document, model } from "mongoose";

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>;
}

export interface IMarketplaceListing extends Document {
  user: mongoose.Schema.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  zone: mongoose.Types.ObjectId;
  
  ratings: {
    count: number;
    average: number;
  };
  name?: string; // added
  images?: string[]; //  added
  description: string;
  currency?: string;
  price: number;
  language?: string;
  languages?: ILanguageTranslation[];
  [key: string]: any; //allow other dynamic fields
}

const MarketplaceListingSchema = new Schema<IMarketplaceListing>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
    },
    zone: {
      type: Schema.Types.ObjectId,
      ref: "Zone",
      required: true,
    },

    ratings: {
      count: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
    },
    name: { type: String }, // added
    images: [{ type: String }], //  added
    description: { type: String, required: true },
    currency: { type: String },
    price: { type: Number, required: true },
    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true, strict: false } // allows dynamic fields
);

export const MarketplaceListing = model<IMarketplaceListing>(
  "MarketplaceListing",
  MarketplaceListingSchema
);
