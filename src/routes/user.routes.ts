import express from "express";
import {
  addForm,
  addToWallet,
  appleLogin,
  createUser,
  deductFromWallet,
  deleteUser,
  forgotPassword,
  getAllUsersWithStats,
  getDashboardStats,
  getListingDocuments,
  getUserDetails,
  getUserDocuments,
  getWallet,
  googleLogin,
  loginUser,
  refreshToken,
  resendOtp,
  resetPassword,
  saveFcmToken,
  updateUserProfile,
  updateUserStatus,
  verifyOtp,
} from "../controllers/user.controller";
import {
  getAllUsers,
  getUserById,
  reviewUserDocument,
  uploadUserDocuments,
} from "../controllers/userDocuments.controller";

import { validateRequest } from "../middlewares/validateRequest";
import {
  createUserSchema,
  forgotPasswordSchema,
  loginUserSchema,
  resendOtpSchema,
  resetPasswordSchema,
  updateUserSchema,
  verifyOtpSchema,
} from "../schemas/user.schema";

import upload, { uploadAny } from "../utils/multer";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateDocuments } from "../middlewares/validateDocuments.middleware";
import expressAsyncHandler from "express-async-handler";
import passport from "passport";
import jwt from "jsonwebtoken";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;


//social logins 
// POST /api/auth/google
router.post("/google", googleLogin);
router.post("/apple", appleLogin);


router.post(
  "/signup",
  upload.single("profilePicture"),
  validateRequest({ body: createUserSchema }),
  createUser
);
router.post("/login", validateRequest({ body: loginUserSchema }), loginUser);
router.post("/refresh-token", refreshToken);


// Endpoint to save FCM token
router.post("/save-fcm-token", useAuth, asyncHandler(saveFcmToken));


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
  // useAuth,
  validateRequest({ body: resetPasswordSchema }),
  resetPassword
);

router.get("/details", useAuth, asyncHandler(getUserDetails));

router.get("/all", useAuth, asyncHandler(getAllUsersWithStats));
router.patch("/:userId/status", useAuth, asyncHandler(updateUserStatus));

router.post("/form", addForm);

// Update profile route with multiple uploads
router.put(
  "/profile",
  useAuth,
  uploadAny,
  validateRequest({ body: updateUserSchema }),
  asyncHandler(updateUserProfile)
);


router.delete("/:userId", useAuth, asyncHandler(deleteUser));

// documents routes
router.get("/userdocs", getUserDocuments);
router.get("/listingdocs", getListingDocuments);

// User uploads document
router.post(
  "/documents/upload",
  useAuth,
  upload.array("filesUrl", 10),
  asyncHandler(uploadUserDocuments)
);
// Admin approves/rejects
router.patch("/documents/review", useAuth, asyncHandler(reviewUserDocument));

// Get all users
router.get("/all", useAuth, asyncHandler(getAllUsers));

// Get wallet balance
router.get("/wallet", useAuth, asyncHandler(getWallet));

// Get user by ID
router.get("/:id", useAuth, asyncHandler(getUserById));


// Add money to wallet
router.post("/wallet/add", useAuth, asyncHandler(addToWallet));

// Deduct money from wallet
router.post("/wallet/deduct", useAuth, asyncHandler(deductFromWallet));

export default router;