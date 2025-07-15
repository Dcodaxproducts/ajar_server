import mongoose, { Schema, Document, model } from "mongoose";

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>; //Flexible translations
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
  user: mongoose.Schema.Types.ObjectId,
  subCategory: mongoose.Types.ObjectId;
  zone: mongoose.Types.ObjectId;
  fields: mongoose.Types.ObjectId[];

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
fields: [
  {
    type: Schema.Types.ObjectId,
    ref: "Field",
    required: true,
  },
],

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
        translations: { type: Schema.Types.Mixed }, //Dynamic
      },
    ],
  },
  { timestamps: true }
);

export const MarketplaceListing = model<IMarketplaceListing>(
  "MarketplaceListing",
  MarketplaceListingSchema
);
