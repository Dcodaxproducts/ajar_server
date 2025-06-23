import mongoose from "mongoose";
import { z } from "zod";

export const languageSchema = z.object({
  title: z
    .string({
      message: "Title is required",
    })
    .nonempty({
      message: "Title cannot be empty",
    }),
  key: z
    .string({
      message: "Key is required",
    })
    .nonempty({
      message: "Key cannot be empty",
    }),
  isRtl: z.boolean({}).default(false),
  isDefault: z.boolean().default(false),
});
