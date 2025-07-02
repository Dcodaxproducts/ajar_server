// models/form.model.ts
import { Schema, model, Document, Types, models } from "mongoose";
import slugify from "slugify";

interface IForm extends Document {
  subCategoryId: Types.ObjectId;
  fieldsIds: Types.ObjectId[];
  zoneId: Types.ObjectId;
  name: string;
  slug?: string;
  description: string;
  language: string;
  languages?: IZoneLanguage[];
}
interface IZoneLanguage {
  locale: string;
  translations: {
    name: string;
    description?: string;
  };
}

const FormSchema = new Schema<IForm>(
  {
    subCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
      // unique: true,
    },
    fieldsIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Field",
        required: true,
      },
    ],
    zoneId: {
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
      // unique: true,
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
        translations: {
          name: String,
          description: String,
        },
      },
    ],
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
