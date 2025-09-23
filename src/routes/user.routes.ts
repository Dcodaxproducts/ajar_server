import express from "express";
import {
  addForm,
  createUser,
  deleteUser,
  forgotPassword,
  getAllUsersWithStats,
  getDashboardStats,
  getUserDetails,
  loginUser,
  refreshToken,
  resendOtp,
  resetPassword,
  // updateDocumentStatus,
  updateUserProfile,
  updateUserStatus,
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

import upload from "../utils/multer";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.post(
  "/signup",
  upload.single("profilePicture"),
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
  authMiddleware,
  validateRequest({ body: resetPasswordSchema }),
  resetPassword
);

router.get("/details", authMiddleware, getUserDetails);

router.get("/all", authMiddleware, getAllUsersWithStats);
router.patch("/:userId/status", authMiddleware, updateUserStatus);

router.post("/form", addForm);

// router.put(
//   "/profile",
//   authMiddleware,
//   upload.single("profilePicture"),
//   validateRequest({ body: updateUserSchema }),
//   updateUserProfile
// );

// Update profile route with multiple uploads
router.put(
  "/profile",
  authMiddleware,
  upload.fields([
    { name: "profilePicture", maxCount: 1 },
    { name: "cnicFront", maxCount: 1 },
    { name: "cnicBack", maxCount: 1 },
    { name: "passport", maxCount: 1 },
    { name: "driving_license_front", maxCount: 1 },
    { name: "driving_license_back", maxCount: 1 },
  ]),
  validateRequest({ body: updateUserSchema }),
  updateUserProfile
);

// Admin-only: Update document status
// PATCH /admin/users/:userId/documents/:docType/status
// router.patch(
//   "/:userId/documents/:docType",
//   authMiddleware, // must be admin
//   updateDocumentStatus
// );

// router.get("/stats", authMiddleware, getDashboardStats);

router.delete("/:userId", authMiddleware, deleteUser);

export default router;
