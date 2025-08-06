import mongoose, { Document, Schema } from "mongoose";
import slugify from "slugify";

//Language translation interface
interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>;
}

//Category interface
interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
  thumbnail?: string;
  type: "category" | "subCategory";
  category?: mongoose.Types.ObjectId;
  subcategories?: ICategory[];
  language?: string;
  languages?: ILanguageTranslation[];
  createdAt: Date;
  updatedAt: Date;
}

// Base schema for both Category and SubCategory
const BaseCategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, required: true },
    thumbnail: { type: String, trim: true },
    image: { type: String, trim: true },
    icon: { type: String, trim: true },
    description: { type: String, trim: true },
    language: { type: String, default: "en" },

    //CHANGED: Added enum + default for discriminator key here
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
        translations: { type: Schema.Types.Mixed },
      },
    ],
  },
  {
    timestamps: true,

    //This tells Mongoose which field to use as the discriminator key
    discriminatorKey: "type",

    toJSON: {
      virtuals: false,
      versionKey: false,
      transform: function (doc, ret) {
        delete ret.id;
        return ret;
      },
    },
    id: false, // disables automatic `id`
  }
);

//Auto-generate slug
BaseCategorySchema.pre("validate", function (next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

//Indexes
BaseCategorySchema.index({ name: 1 });
BaseCategorySchema.index({ slug: 1 });

//Virtual relation to subcategories
BaseCategorySchema.virtual("subcategories", {
  ref: "subCategory",
  localField: "_id",
  foreignField: "category",
});

//Virtuals setup
BaseCategorySchema.set("toJSON", {
  virtuals: false,
  versionKey: false,
  transform: function (doc, ret) {
    ret.id && delete ret.id;
    return ret;
  },
});
BaseCategorySchema.set("toObject", { virtuals: true });

// Base model
const Category = mongoose.model<ICategory>("Category", BaseCategorySchema);

const SubCategory = Category.discriminator("subCategory", new Schema({}));

export { Category, SubCategory, ICategory };
