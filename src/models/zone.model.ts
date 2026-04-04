import mongoose, { Schema, Document } from "mongoose";
import { IRentalPolicies } from "./rentalPolicy.model";

export interface IZoneLanguage {
  locale: string;
  translations: Record<string, any>;
}

export interface IZone extends Document {
  name: string;
  subCategories: mongoose.Types.ObjectId[];
  currency: string;
  language: string;
  languages?: IZoneLanguage[];
  polygons: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
  // Reference to the new RentalPolicy Model
  rentalPolicies: mongoose.Types.ObjectId | IRentalPolicies;
  createdAt: Date;
  updatedAt: Date;
}

const ZoneLanguageSchema = new Schema<IZoneLanguage>(
  {
    locale: { type: String, required: true },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const ZoneSchema = new Schema<IZone>(
  {
    name: { type: String, required: true, trim: true },
    subCategories: [
      { type: mongoose.Schema.Types.ObjectId, ref: "subCategory" },
    ],
    currency: { type: String, required: true, trim: true },
    language: { type: String, default: "en" },
    polygons: {
      type: {
        type: String,
        enum: ["MultiPolygon"],
        default: "MultiPolygon",
      },
      coordinates: {
        type: [[[[Number]]]],
        default: [],
      },
    },
    languages: { type: [ZoneLanguageSchema], default: [] },
    // Reference update
    rentalPolicies: { type: mongoose.Schema.Types.ObjectId, ref: "RentalPolicy" },
  },
  { timestamps: true }
);

ZoneSchema.index({ name: 1 });

export const Zone = mongoose.model<IZone>("Zone", ZoneSchema);