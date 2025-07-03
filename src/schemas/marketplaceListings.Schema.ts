import { z } from "zod";
import mongoose from "mongoose";

const objectIdSchema = z
  .string()
  .refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: "Invalid ObjectId",
  });

const marketplaceListingFieldSchema = z.object({
  name: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  field: objectIdSchema,
});

export const marketplaceListingSchema = z.object({
  subCategoryId: objectIdSchema,
  zoneId: objectIdSchema,
  fields: z.array(marketplaceListingFieldSchema).nonempty("Fields are required"),
  description: z.string(),
  currency: z.string(),
  price: z.number(),
  requiredDocs: z.array(marketplaceListingFieldSchema).optional(),
});
