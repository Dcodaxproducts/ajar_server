import { z } from "zod";
import mongoose from "mongoose";

export const categorySchema = z.object({
  name: z
    .string({ required_error: "Category name is required" })
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),

  status: z.enum(["active", "inactive"]).default("active"),

  type: z
    .enum(["category", "subCategory"], {
      required_error: "Category type is required",
    })
    .default("category"),

  category: z
    .string()
    .optional()
    .refine((val) => !val || mongoose.Types.ObjectId.isValid(val), {
      message: "Invalid category ID",
    }),
});
