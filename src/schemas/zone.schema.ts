import { z } from "zod";

export const zoneSchema = z.object({
  name: z
    .string({ required_error: "Zone name is required" })
    .min(3, "Name must be at least 3 characters")
    .max(100),
    subCategoriesId: z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((val) => {
    if (typeof val === "string") return JSON.parse(val);
    return val;
  }),

  country: z
    .string({ required_error: "Country is required" })
    .min(2, "Country must be at least 2 characters"),
  currency: z
    .string({ required_error: "Currency is required" })
    .min(1, "Currency must be at least 1 character"),
  timeZone: z
    .string({ required_error: "Time zone is required" })
    .min(1, "Time zone must be specified"),
  language: z
    .string({ required_error: "Language is required" })
    .min(2, "Language must be at least 2 characters"),
  // Remove categories for now as not in model
  radius: z
    .number({ invalid_type_error: "Radius must be a number" })
    .nonnegative("Radius cannot be negative")
    .optional()
    .default(0),
  latLng: z
  .array(
    z.object({
      lat: z.number(),
      lng: z.number(),
    })
  )
  .min(1)
  .optional(),

  adminNotes: z.string().optional(),
});
