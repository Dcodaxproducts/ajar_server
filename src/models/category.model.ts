import mongoose, { Document, Schema } from "mongoose";
import slugify from "slugify";

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>; //Flexible translations
}

interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
  thumbnail?: string;
  type: "category" | "subCategory";
  category?: mongoose.Types.ObjectId;
  language?: string;
  languages?: ILanguageTranslation[];
  createdAt: Date;
  updatedAt: Date;
}

const BaseCategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, required: true },
    thumbnail: { type: String, trim: true },
    image: { type: String, trim: true },
    icon: { type: String, trim: true },
    description: { type: String, trim: true },
    language: { type: String, default: "en" },
    type: {
      type: String,
      required: true,
      enum: ["category", "subCategory"],
      default: "category",
    },
    category: { type: Schema.Types.ObjectId, ref: "Category" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed }, //Dynamic
      },
    ],
  },
  { timestamps: true, discriminatorKey: "type" }
);

BaseCategorySchema.pre("validate", function (next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

BaseCategorySchema.index({ name: 1 });
BaseCategorySchema.index({ slug: 1 });

BaseCategorySchema.virtual("subcategories", {
  ref: "SubCategory",
  localField: "_id",
  foreignField: "category",
});

BaseCategorySchema.set("toJSON", { virtuals: true });
BaseCategorySchema.set("toObject", { virtuals: true });

const Category = mongoose.model<ICategory>("Category", BaseCategorySchema);
const SubCategory = Category.discriminator("SubCategory", new Schema({}));

export { Category, SubCategory, ICategory };
