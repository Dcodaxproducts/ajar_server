import { Schema, model, Document, Types, models } from "mongoose";
import slugify from "slugify";

interface IZoneLanguage {
   locale: string;
  translations: Record<string, any>; 
}

// Setting interface
interface ISetting {
  commissionType: "fixed" | "percentage";
  leaserCommission: number;
  renterCommission: number;
  tax: number;
  expiry: Date
}

interface IForm extends Document {
  subCategory: Types.ObjectId;
  fields: Types.ObjectId[];
  zone: Types.ObjectId;
  name: string;
  slug?: string;
  description: string;
  language: string;
  languages?: IZoneLanguage[];
  setting: ISetting;
}


const FormSchema = new Schema<IForm>(
  {
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
    },
    fields: [
      {
        type: Schema.Types.ObjectId,
        ref: "Field",
        required: true,
      },
    ],
    zone: {
      type: Schema.Types.ObjectId,
      ref: "Zone",
      required: true,
    },
    name: {
      type: String,
      trim: true,
      required: true,
    },
    slug: {
      type: String,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      required: true,
    },
    language: { type: String, default: "en" }, 
       languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed }, //Dynamic
      },
    ],
 
    setting: {
      commissionType: {
        type: String,
        enum: ["fixed", "percentage"],
        default: "fixed",
      },
      leaserCommission: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
      renterCommission: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
      tax: {
        type: Number,
        default: 0,
      },
      expiry: {
        type: Date,
        required: true,
      }
    },
  },
  {
    timestamps: true,
  }

);

// Generate slug before saving
FormSchema.pre("validate", function (next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = this.name ? slugify(this.name, { lower: true, strict: true }) : undefined;
  }
  next();
});

// FormSchema.index({ order: 1 });

// delete models.Form

export const Form = model<IForm>("Form", FormSchema);
