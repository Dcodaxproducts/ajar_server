import express from "express";
import {
  addBankAccount,
  addForm,
  addToWallet,
  appleLogin,
  changePassword,
  createUser,
  deductFromWallet,
  deleteBankAccount,
  deleteUser,
  forgotPassword,
  getAllUsersWithStats,
  getAllWithdrawals,
  getBankAccounts,
  getDashboardStats,
  getListingDocuments,
  getUserDetails,
  getUserDocuments,
  getUserWithdrawals,
  getWallet,
  getWithdrawalHistoryByRange,
  googleLogin,
  instantWithdrawal,
  loginUser,
  processWithdrawal,
  refreshToken,
  resendOtp,
  resetPassword,
  saveFcmToken,
  updateBankAccount,
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

import upload, { uploadAny, uploadFiles } from "../utils/multer";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateDocuments } from "../middlewares/validateDocuments.middleware";
import expressAsyncHandler from "express-async-handler";
import passport from "passport";
import jwt from "jsonwebtoken";
import { changePasswordSchema } from "../schemas/changePassword.schema";

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

router.post(
  "/change-password",
  useAuth,
  validateRequest({ body: changePasswordSchema }),
  changePassword
);

router.get("/details", useAuth, asyncHandler(getUserDetails));
router.get("/bank-account", useAuth, asyncHandler(getBankAccounts));

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

router.get("/my-withdrawals/range", useAuth, asyncHandler(getWithdrawalHistoryByRange));
// router.get("/wallet/graph", useAuth, asyncHandler(getWalletGraph));

router.get(
  "/my-withdrawals",
  useAuth,
  asyncHandler(getUserWithdrawals)
);

// ADMIN ROUTES
router.get(
  "/withdrawals",
  useAuth,
  asyncHandler(getAllWithdrawals)
);

// Get user by ID
router.get("/:id", useAuth, asyncHandler(getUserById));

// Add money to wallet
router.post("/wallet/add", useAuth, asyncHandler(addToWallet));

// Deduct money from wallet
router.post("/wallet/deduct", useAuth, asyncHandler(deductFromWallet));

// router.get("/bank-account", useAuth, asyncHandler(getBankAccounts));
router.post("/bank-account", useAuth, asyncHandler(addBankAccount));

router.put("/bank-account/:bankAccountId", useAuth, asyncHandler(updateBankAccount));
router.delete("/bank-account/:bankAccountId", useAuth, asyncHandler(deleteBankAccount));

router.post("/withdrawals-request", useAuth, asyncHandler(instantWithdrawal));

router.put(
  "/withdrawals/:requestId",
  useAuth,
  asyncHandler(processWithdrawal)
);

export default router;