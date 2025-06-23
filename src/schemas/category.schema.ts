import { z } from "zod";
import mongoose from "mongoose";

export const categorySchema = z.object({
  name: z
    .string({ required_error: "Category name is required" })
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  status: z.enum(["active", "inactive"]).default("active"),
  zoneId: z
    .string({ required_error: "Zone ID is required" })
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "Invalid Zone ID",
    }),
});
