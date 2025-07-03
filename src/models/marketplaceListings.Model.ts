import mongoose, { Schema, Document } from "mongoose";

interface MarketplaceListingField {
  name: string;
  value: string | number | boolean;
  field: mongoose.Types.ObjectId;
}

export interface IMarketplaceListing extends Document {
  subCategoryId: mongoose.Types.ObjectId;
  zoneId: mongoose.Types.ObjectId;
  fields: MarketplaceListingField[];
  ratings: {
    count: number;
    average: number;
  };
  description: string;
  currency: string;
  price: number;
  requiredDocs: MarketplaceListingField[];
}

const MarketplaceListingFieldSchema = new Schema<MarketplaceListingField>(
  {
    name: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    field: { type: Schema.Types.ObjectId, ref: "Field", required: true },
  },
  { _id: false }
);

const MarketplaceListingSchema = new Schema<IMarketplaceListing>(
  {
    subCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
    },
    zoneId: { type: Schema.Types.ObjectId, ref: "Zone", required: true },
    ratings: {
      count: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
    },
    fields: { type: [MarketplaceListingFieldSchema], required: true },
    description: { type: String, required: true },
    currency: { type: String, required: true },
    price: { type: Number, required: true },
    requiredDocs: { type: [MarketplaceListingFieldSchema], default: undefined },
  },
  { timestamps: true }
);

export const MarketplaceListing = mongoose.model<IMarketplaceListing>("MarketplaceListing", MarketplaceListingSchema);
