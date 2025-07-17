import mongoose from "mongoose";
import { z } from "zod";

export const createUserSchema = z.object({
  name: z
    .string({
      required_error: "name is required",
    })
    .min(3)
    .max(50),
  email: z
    .string({
      required_error: "email is required",
    })
    .email()
    .min(6, { message: "Email is too short" }),
  password: z
    .string({
      required_error: "password is required",
    })
    .min(6, { message: "Password is too short" }),

  dob: z
    .string({
      required_error: "dob is required",
    })
    .min(6, { message: "dob is too short" }),
  nationality: z
    .string({
      required_error: "nationality is required",
    })
    .min(3, { message: "nationality is too short" }),
  user_type: z
    .string({
      required_error: "user_type is required",
    })
    .min(3, { message: "user_type is too short" }),
});

export const loginUserSchema = z.object({
  email: z
    .string({
      required_error: "email is required",
    })
    .email()
    .min(6, { message: "Email is too short" }),
  password: z
    .string({
      required_error: "password is required",
    })
    .min(6, { message: "Password is too short" }),
});

export const userDetailsSchema = z.object({
  id: z
    .string({ required_error: "id is required" })
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "Invalid MongoDB ObjectId",
    }),
});

export const resendOtpSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Invalid email address"),
});

export const verifyOtpSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Invalid email address"),
  otp: z
    .string({ required_error: "OTP is required" })
    .min(4, "OTP must be 4 characters"),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
 
  password: z
    .string({ required_error: "Password is required" })
    .min(4, "Password must be at least 4 characters"),
  resetToken: z
    .string({ required_error: "Reset token is required" })
    .min(6, "Reset token must be at least 6 characters"),
});

export const updateUserSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters").optional(),
  email: z.string().email("Invalid email format").optional(),
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .optional(),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .optional(),
});
