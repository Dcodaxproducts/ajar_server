import express from "express";
import {
  addForm,
  createUser,
  forgotPassword,
  getAllUsers,
  getUserDetails,
  loginUser,
  refreshToken,
  resendOtp,
  resetPassword,
  updateUserProfile,
  verifyOtp,
} from "../controllers/user.controller";
import { validateRequest } from "../middlewares/validateRequest";
import {
  createUserSchema,
  forgotPasswordSchema,
  loginUserSchema,
  resendOtpSchema,
  resetPasswordSchema,
  updateUserSchema,
  userDetailsSchema,
  verifyOtpSchema,
} from "../schemas/user.schema";
import { authMiddleware } from "../middlewares/auth.middleware";
import upload from "../utils/multer";

const router = express.Router();

router.post(
  "/signup",
  upload.single("image"),
  validateRequest({ body: createUserSchema }),
  createUser
);
router.post("/login", validateRequest({ body: loginUserSchema }), loginUser);
router.post("/refresh-token", refreshToken);

router.post(
  "/resend-otp",
  validateRequest({ body: resendOtpSchema }),
  resendOtp
);

router.post(
  "/verify-otp",
  validateRequest({ body: verifyOtpSchema }),
  verifyOtp
);

router.post(
  "/forgot-password",
  validateRequest({ body: forgotPasswordSchema }),
  forgotPassword
);

router.post(
  "/reset-password",
  validateRequest({ body: resetPasswordSchema }),
  resetPassword
);

router.get("/details", authMiddleware, getUserDetails);

router.post("/form", addForm);

router.put(
  "/profile",
  authMiddleware,
  upload.single("profilePicture"),
  validateRequest({ body: updateUserSchema }),
  updateUserProfile
);

export default router;
