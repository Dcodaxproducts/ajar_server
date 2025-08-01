import mongoose, { Schema, Document } from "mongoose";

interface IZoneLanguage {
  locale: string;
  translations: Record<string, any>; //Flexible translations
}

interface IZone extends Document {
  name: string;
  subCategories: string[]; 
  currency: string; 
  language: string;
  languages?: IZoneLanguage[];
  polygons: { lat: number; lng: number }[];
  createdAt: Date;
  updatedAt: Date;
}

const ZoneSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    subCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: "SubCategory" }],
    currency: { type: String, required: true, trim: true },
    language: { type: String, default: "en" }, 
    polygons: {
  type: [
    [
      {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
    ],
  ],
  default: [],
},
    // polygons: [{ type: [{ lat: Number, lng: Number }], default: [] }],
    languages: [
  {
    locale: { type: String },
    translations: { type: Schema.Types.Mixed }, 
  },
],
  },
  { timestamps: true }
);

ZoneSchema.index({ name: 1 });

const Zone = mongoose.model<IZone>("Zone", ZoneSchema);

export { Zone, IZone };

