import mongoose, { Schema, Document } from "mongoose";

interface IZone extends Document {
  name: string;
  description: string;
  subCategories: string[];
  currency: string;
  timeZone: string;
  language: string;
  radius: number;
  latLng: { lat: number; lng: number }[];
  thumbnail?: string;
  icon?: string;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ZoneSchema = new Schema<IZone>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    subCategories: { type: [String], default: [] },
    currency: { type: String, required: true, trim: true },
    timeZone: { type: String, required: true, trim: true },
    language: { type: String, required: true, trim: true },
    radius: { type: Number, default: 0 },
    thumbnail: { type: String, default: "" },
    icon: { type: String, default: "" },
    latLng: { type: [{ lat: Number, lng: Number }], default: [] },
    adminNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

ZoneSchema.index({ name: 1 });

const Zone = mongoose.model<IZone>("Zone", ZoneSchema);

export { Zone, IZone };