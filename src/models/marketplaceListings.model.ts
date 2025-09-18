import mongoose, { Schema, Document, model } from "mongoose";

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>;
}

export interface IMarketplaceListing extends Document {
  leaser: mongoose.Schema.Types.ObjectId;
  subCategory: mongoose.Types.ObjectId;
  zone: mongoose.Types.ObjectId;

  ratings: {
    count: number;
    average: number;
  };
  name?: string;
  subTitle: string;
  images?: string[];
  rentalImages?: string[];
  description: string;
  address: string;
  currency?: string;
  price: number;
  isActive?: boolean;
  language?: string;
  languages?: ILanguageTranslation[];
  [key: string]: any;
}

const MarketplaceListingSchema = new Schema<IMarketplaceListing>(
  {
    leaser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "subCategory",
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
    name: { type: String, required: true },
    subTitle: { type: String, required: true },
    images: [{ type: String }],
    rentalImages: [{ type: String, required: true }],
    description: { type: String },
    address: { type: String },
    currency: { type: String },
    price: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed },
      },
    ],

    isAvailable: { type: Boolean, default: true },
    currentBookingId: [{
      type: Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    }],
  },
  { timestamps: true, strict: false } // allows dynamic fields
);

export const MarketplaceListing = model<IMarketplaceListing>(
  "MarketplaceListing",
  MarketplaceListingSchema
);
