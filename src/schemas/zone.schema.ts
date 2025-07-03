import { z } from "zod";

export const zoneSchema = z.object({
  name: z
    .string({ required_error: "Zone name is required" })
    .min(3, "Name must be at least 3 characters")
    .max(100, "Name must not exceed 100 characters"),

  subCategories: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === "string") return JSON.parse(val);
      return val;
    }),

  currency: z
    .string({ required_error: "Currency is required" })
    .min(1, "Currency must be at least 1 character"),

  timeZone: z
    .string({ required_error: "Time zone is required" })
    .min(1, "Time zone must be specified"),

  language: z
    .string({ required_error: "Language is required" })
    .min(2, "Language must be at least 2 characters"),

  polygons: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
      })
    )
    .min(1, "At least one polygon coordinate is required")
    .optional(),

  languages: z
    .array(
      z.object({
        locale: z
          .string({ required_error: "Locale is required" })
          .min(2, "Locale must be at least 2 characters"),
        translations: z
          .object({
            name: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),

  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
