import express from "express";
import {
  addForm,
  appleLogin,
  createUser,
  deleteUser,
  forgotPassword,
  getAllUsersWithStats,
  getDashboardStats,
  getListingDocuments,
  getUserDetails,
  getUserDocuments,
  googleLogin,
  loginUser,
  refreshToken,
  resendOtp,
  resetPassword,
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

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


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

// Update profile route with multiple uploads
router.put(
  "/profile",
  authMiddleware,
  uploadAny,
  validateRequest({ body: updateUserSchema }),
  updateUserProfile
);


// router.put(
//   "/profile",
//   authMiddleware,
//   upload.fields([
//     { name: "profilePicture", maxCount: 1 },
//     { name: "cnic", maxCount: 1 },
//     { name: "passport", maxCount: 1 },
//     { name: "drivingLicense", maxCount: 1 },
//   ]),
//   validateRequest({ body: updateUserSchema }),
//   updateUserProfile
// );



router.delete("/:userId", authMiddleware, deleteUser);

// documents routes
router.get("/userdocs", getUserDocuments);
router.get("/listingdocs", getListingDocuments);

// User uploads document
router.post(
  "/documents/upload",
  authMiddleware,
  upload.array("filesUrl", 10),
  asyncHandler(uploadUserDocuments)
);
// Admin approves/rejects
router.patch("/documents/review", authMiddleware, reviewUserDocument);

// Get all users
router.get("/all", authMiddleware, asyncHandler(getAllUsers));

// Get user by ID
router.get("/:id", authMiddleware, asyncHandler(getUserById));

export default router;
