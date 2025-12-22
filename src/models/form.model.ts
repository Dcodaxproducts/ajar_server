import { Schema, model, Document, Types } from "mongoose";

interface IZoneLanguage {
  locale: string;
  translations: Record<string, any>;
}

interface ISetting {
  commissionType: "fixed" | "percentage";
  leaserCommission: { value: number; min: number; max: number };
  renterCommission: { value: number; min: number; max: number };
  tax: number;
  expiry: Date;
}

export interface IForm extends Document {
  name: string;
  description: string;
  subCategory: Types.ObjectId;
  fields: Types.ObjectId[];
  zone: Types.ObjectId;
  language: string;
  languages?: IZoneLanguage[];
  setting: ISetting;
  userDocuments: string[];
  leaserDocuments: string[];
}

const FormSchema = new Schema<IForm>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "subCategory",
      required: true,
    },
    fields: [{ type: Schema.Types.ObjectId, ref: "Field", required: true }],
    zone: { type: Schema.Types.ObjectId, ref: "Zone", required: true },

    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed },
      },
    ],

    setting: {
      commissionType: {
        type: String,
        enum: ["fixed", "percentage"],
        default: "fixed",
      },
      leaserCommission: {
        value: { type: Number, min: 0, max: 100, default: 0 },
        min: { type: Number, default: 0 },
        max: { type: Number, default: 100 },
      },
      renterCommission: {
        value: { type: Number, min: 0, max: 100, default: 0 },
        min: { type: Number, default: 0 },
        max: { type: Number, default: 100 },
      },
      tax: { type: Number, default: 0 },
      expiry: { type: Date, required: true },
    },

    userDocuments: {
      type: [String],
      default: [],
    },
    leaserDocuments: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

export const Form = model<IForm>("Form", FormSchema);
