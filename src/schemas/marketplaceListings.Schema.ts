import { z } from "zod";
import mongoose from "mongoose";

//Language translation schema
const languageTranslationSchema = z.object({
  locale: z.string().min(2, "Locale is required"),
  translations: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }),
});

//Marketplace Listing Schema - updated to accept ObjectIds as strings
export const marketplaceListingSchema = z.object({
  subCategory: z
    .string()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "Invalid SubCategory ID",
    }),

  zone: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: "Invalid Zone ID",
  }),

  price: z.number().positive(),
  priceUnit: z.enum(["hour", "day", "month", "year"]),


  ratings: z
    .object({
      count: z.number().int().nonnegative().default(0),
      average: z.number().min(0).max(5).default(0),
    })
    .optional(),


  language: z.string().default("en").optional(),

  languages: z.array(languageTranslationSchema).optional(),
});
