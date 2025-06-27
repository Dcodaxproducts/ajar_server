import mongoose, { Document, Schema } from "mongoose";
import slugify from "slugify";


interface ILanguageTranslation {
  locale: string;
  translations: {
    name?: string;
    description?: string;
  };
}


// Interface updated: added description, icon, image
interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;  
  icon?: string;          
  image?: string;         
  thumbnail?: string;     // optional, still supported if you prefer
  categoryType: "category" | "subCategory";
  categoryId?: mongoose.Types.ObjectId;
   language?: string;
    languages?: ILanguageTranslation[];
  createdAt: Date;
  updatedAt: Date;
}

// Base schema (for both Category and SubCategory)
const BaseCategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, required: true },
    thumbnail: { type: String, trim: true },
    image: { type: String, trim: true },       
    icon: { type: String, trim: true },       
    description: { type: String, trim: true },  
     language: { type: String, default: "en" },
    categoryType: {
      type: String,
      required: true,
      enum: ["category", "subCategory"],
      default: "category",
    },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
   languages: [
      {
        locale: { type: String, required: true },
        translations: {
          name: { type: String },
          description: { type: String },
        },
      },
    ],
  },
  { timestamps: true, discriminatorKey: "categoryType" }
);

// Slug generator (unchanged)
BaseCategorySchema.pre("validate", function (next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

// Indexes (unchanged)
BaseCategorySchema.index({ name: 1 });
BaseCategorySchema.index({ slug: 1 });

// Virtual for subcategories (unchanged)
BaseCategorySchema.virtual("subcategories", {
  ref: "SubCategory",
  localField: "_id",
  foreignField: "categoryId",
});

BaseCategorySchema.set("toJSON", { virtuals: true });
BaseCategorySchema.set("toObject", { virtuals: true });

const Category = mongoose.model<ICategory>("Category", BaseCategorySchema);


const SubCategory = Category.discriminator("SubCategory", new Schema({}));

export { Category, SubCategory, ICategory };
