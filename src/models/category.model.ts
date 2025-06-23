import mongoose, { Document, models, Schema } from "mongoose";
import slugify from "slugify";

interface ICategory extends Document {
  name: string;
  slug: string;
  thumbnail?: string;
  zoneId: mongoose.Types.ObjectId;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      lowercase: true,
      trim: true,
      required: true,
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    thumbnail: { type: String, trim: true },
    zoneId: { type: Schema.Types.ObjectId, ref: "Zone", required: true },
  },
  { timestamps: true }
);

CategorySchema.pre("validate", function(next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

// Compound indexes for uniqueness per zoneId
CategorySchema.index({ zoneId: 1, name: 1 }, { unique: true });
CategorySchema.index({ zoneId: 1, slug: 1 }, { unique: true });

// delete models.Categories
const Category = mongoose.model<ICategory>("Category", CategorySchema);
export { Category, ICategory };
