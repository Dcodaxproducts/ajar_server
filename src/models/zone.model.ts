import mongoose, { Schema, Document } from "mongoose";

interface IZone extends Document {
  name: string;
  subCategoriesId: string; 
  currency: string;
  country: string; 
  timeZone: string;
  language: string;
  radius: number;
  latLng: { lat: number; lng: number }[];
  thumbnail?: string;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ZoneSchema = new Schema<IZone>(
  {
    name: { type: String, required: true, trim: true },
    subCategoriesId: [{ type: mongoose.Schema.Types.ObjectId, ref: "SubCategory" }],
    currency: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    timeZone: { type: String, required: true, trim: true },
     language: { type: String, default: "en" }, 
    radius: { type: Number, default: 0 },
    thumbnail: { type: String, default: "" },
    latLng: { type: [{ lat: Number, lng: Number }], default: [] },
    adminNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

ZoneSchema.index({ name: 1 });

const Zone = mongoose.model<IZone>("Zone", ZoneSchema);

export { Zone, IZone };