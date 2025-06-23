import { z } from "zod";

export const createPaymentSchema = z.object({
  amount: z
    .number({ required_error: "Amount is required" })
    .min(1, { message: "Amount must be at least 1" }),
  currency: z
    .string({ required_error: "Currency code is required" })
    .length(3, { message: "Currency code must be 3 letters" }),
  paymentMethodId: z.string().optional(),
  description: z.string().optional(),
});

// verify payment
export const verifyPaymentSchema = z.object({
  paymentIntentId: z.string({
    required_error: "Payment intent ID is required",
  }),
});

export const transferSchema = z.object({
  amount: z
    .number({ required_error: "Amount is required" })
    .positive("Amount must be greater than zero"),
  currency: z
    .string({ required_error: "Currency is required" })
    .length(3, "Currency must be a valid 3-letter code (e.g., USD)"),
  vendorId: z.string({ required_error: "Vendor ID is required" }),
});
