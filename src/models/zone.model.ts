import mongoose, { Schema, Document } from "mongoose";

interface ICategoryField {
  fieldName: string;
  fieldType: "string" | "number" | "boolean" | "file";
  required: boolean;
}

interface IZoneCategorySettings {
  enabled: boolean;
  form: mongoose.Types.ObjectId;
}

interface IZone extends Document {
  name: string;
  country: string;
  currency: string;
  timeZone: string;
  language: string;
  status: "active" | "inactive";
  radius: number;
  latlong: number[];
  thumbnail?: string;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ZoneSchema = new Schema<IZone>(
  {
    name: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    currency: { type: String, required: true, trim: true },
    timeZone: { type: String, required: true, trim: true },
    language: { type: String, required: true, trim: true },
    radius: { type: Number, default: 0 },
    thumbnail: { type: String, default: "" },
    latlong: { type: [Number], default: [] },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    adminNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

ZoneSchema.index({ name: 1 });
ZoneSchema.index({ country: 1 });

const Zone = mongoose.model<IZone>("Zone", ZoneSchema);

export { Zone, IZone };
