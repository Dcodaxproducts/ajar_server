import mongoose, { Schema, Document, model } from "mongoose";

interface ILanguageTranslation {
  local: string;
  translations: {
    name?: string;
    description?: string;
  };
}

interface MarketplaceListingField {
  name: string;
  description: string;
  image: string;
  price: number;
  company: string;
  link?: string;
  model?: string;
  color?: string;
  size?: string;
  rent?: number;
}
  
export interface IMarketplaceListing extends Document {
  form: mongoose.Types.ObjectId;
  fields: MarketplaceListingField[];
  ratings: {
    count: number;
    average: number;
  };
  description: string;
  currency: string;
  price: number;
  language?: string;
  languages?: ILanguageTranslation[];
}

const MarketplaceListingFieldSchema = new Schema<MarketplaceListingField>(
 {
    name: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String, required: true },
    price: { type: Number, required: true },
    company: { type: String, required: true },
    link: { type: String },
    model: { type: String },
    color: { type: String },
    size: { type: String },
    rent: { type: Number }
  },
  { _id: false } 
);

const MarketplaceListingSchema = new Schema<IMarketplaceListing>(
  {
    form: {
      type: Schema.Types.ObjectId,
      ref: "Form",
      required: true,
    },
    fields: {
      type: [MarketplaceListingFieldSchema],
      required: true,
    },
    ratings: {
      count: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
    },
    description: { type: String, required: true },
    currency: { type: String, required: true },
    price: { type: Number, required: true },
    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: {
          name: { type: String },
          description: { type: String },
        },
      },
    ],
  },
  { timestamps: true }
);

export const MarketplaceListing = model<IMarketplaceListing>(
  "MarketplaceListing",
  MarketplaceListingSchema
);
