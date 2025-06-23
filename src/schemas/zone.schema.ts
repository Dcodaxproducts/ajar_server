import { z } from "zod";

export const zoneSchema = z.object({
  name: z
    .string({ required_error: "Zone name is required" })
    .min(3, "Name must be at least 3 characters")
    .max(100),
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
  latlong: z
    .array(z.number())
    .length(2, "Latlong must contain exactly 2 coordinates (lat, long)")
    .optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  adminNotes: z.string().optional(),
});
