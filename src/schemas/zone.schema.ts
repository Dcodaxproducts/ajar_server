import { z } from "zod";

export const zoneSchema = z.object({
  name: z
    .string({ required_error: "Zone name is required" })
    .min(3, "Name must be at least 3 characters")
    .max(100, "Name must not exceed 100 characters"),

  currency: z
    .string({ required_error: "Currency is required" })
    .min(1, "Currency must be at least 1 character"),

  subCategories: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === "string") return JSON.parse(val);
      return val;
    }),

  timeZone: z.string().min(1, "Time zone must be specified").optional(),

  language: z
    .string()
    .min(2, "Language must be at least 2 characters")
    .optional(),

  polygons: z
    .array(
      z.array(
        z.object({
          lat: z.number(),
          lng: z.number(),
        })
      )
    )
    .min(1, "At least one polygon path is required")
    .optional(),
  languages: z
    .array(
      z.object({
        locale: z.string().min(2, "Locale must be at least 2 characters"),
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
