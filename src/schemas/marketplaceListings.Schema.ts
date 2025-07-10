import { z } from "zod";
import mongoose from "mongoose";

export const marketplaceListingFieldSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  image: z.string().url("Image must be a valid URL"),
  price: z.number().nonnegative("Price must be a positive number"),
  company: z.string().min(1, "Company is required"),
  link: z.string().url().optional(),
  model: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  rent: z.number().nonnegative().optional(),
});


const languageTranslationSchema = z.object({
  locale: z.string().min(2, "Locale is required"),
  translations: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }),
});


export const marketplaceListingSchema = z.object({
  form: z
    .string()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "Invalid Form ID",
    }),
  fields: z.array(marketplaceListingFieldSchema).min(1),
  ratings: z
    .object({
      count: z.number().int().nonnegative().default(0),
      average: z.number().min(0).max(5).default(0),
    })
    .optional(),
  description: z.string().min(1, "Description is required"),
  currency: z.string().min(1, "Currency is required"),
  price: z.number().nonnegative("Price must be positive"),
  language: z.string().default("en").optional(),
  languages: z.array(languageTranslationSchema).optional(),
});
