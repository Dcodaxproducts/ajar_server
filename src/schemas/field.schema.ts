import { z } from "zod";

export const fieldSchema = z.object({
  name: z
    .string({ required_error: "Field name is required" })
    .min(1, "Field name must be at least 1 character"),

    type: z.array(z.string()).optional(), 

  placeholder: z
    .string({ required_error: "Placeholder is required" })
    .min(1, "Placeholder must be at least 1 character"),

  label: z
    .string({ required_error: "Label is required" })
    .min(1, "Label must be at least 1 character"),

  isMultiple: z.boolean().optional(),

  options: z.array(z.string()).optional(),

  order: z.number().int().nonnegative().optional(),

  tooltip: z.string().optional(),

  visible: z.boolean().default(true).optional(),

  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),

  readonly: z.boolean().optional(),

  dependencies: z.record(z.any()).optional(),

  validation: z
    .object({
      required: z.boolean({
        required_error: "Validation 'required' flag is required",
      }),
      pattern: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});
