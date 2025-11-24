import { Request, Response } from "express";
import { User } from "../models/user.model";
import {
  encrypt,
  decrypt,
  generateTempSecret,
  generateBackupCodes,
  hashBackupCodes,
} from "../utils/2fa.utils";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { generateAccessToken } from "../utils/jwt.utils";
import { sendEmail } from "../helpers/node-mailer";




// ======================== ENABLE 2FA FLAG ========================
export const enable2FA_Flag = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendResponse(res, null, "Unauthorized", 401);

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, "User not found", 404);

    // ------------- CHANGE MADE -------------
    // Do NOT enable fully yet; user must verify first
    user.twoFactor.enabled = false;       // <-- changed from true
    user.twoFactorVerified = false;       // still not verified
    await user.save();

    sendResponse(res, { twoFactor: user.twoFactor }, "2FA flag enabled. Please complete setup.", 200);
  } catch (err) {
    console.log(err);
    sendResponse(res, null, "Server error", 500);
  }
};

// ======================== START 2FA SETUP ========================
export const enable2FA_Start = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, "User not found", 404);

    // 1) Generate temp secret
    const secret = await generateTempSecret(user.name, user.email);
    user.twoFactor.tempSecret = encrypt(secret.base32);

    // 2) Generate 6-digit setup OTP
    const setupOTP = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactor.tempOTP = {
      code: setupOTP,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };

    // ------------- CHANGE MADE -------------
    // Keep twoFactor.enabled false until verification
    user.twoFactor.enabled = false;
    user.twoFactorVerified = false;

    await user.save();

    // 3) Send OTP to email
    await sendEmail({
      to: user.email,
      name: user.name,
      subject: "Your 2FA Setup Verification Code",
      content: `Your setup verification code is: ${setupOTP}. It expires in 5 minutes.`
    });

    sendResponse(
      res,
      { requireVerification: true },
      "2FA setup started. Verification code sent to email.",
      200
    );
  } catch (err) {
    console.log(err);
    sendResponse(res, null, "Server error", 500);
  }
};

// ======================== VERIFY 2FA ========================
export const verify2FA = async (req: any, res: Response) => {
  try {
    const { token } = req.body;
    const userId = req.user?.id;

    if (!token) {
      return sendResponse(res, null, "2FA code is required", 400);
    }

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, "User not found", 404);

    // ------------------ LOGIN VERIFICATION ------------------
    if (user.twoFactor.loginCode && user.twoFactor.loginExpiry) {
      if (user.twoFactor.loginExpiry < new Date())
        return sendResponse(res, null, "2FA login code expired", 400);

      if (user.twoFactor.loginCode !== token)
        return sendResponse(res, null, "Invalid 2FA login code", 400);

      // Clear loginCode
      user.twoFactor.loginCode = null;
      user.twoFactor.loginExpiry = null;
      await user.save();

      // Generate full token
      const accessToken = generateAccessToken({
        id: user._id,
        role: user.role,
        twoFactorVerified: true,
      });

      return sendResponse(
        res,
        { token: accessToken, user },
        "Login successful",
        200
      );
    }

    // ------------------ SETUP VERIFICATION ------------------
    if (user.twoFactor.tempOTP && user.twoFactor.tempSecret) {
      const temp = user.twoFactor.tempOTP;

      if (temp.expiresAt < new Date())
        return sendResponse(res, null, "Verification code expired", 400);

      if (temp.code !== token)
        return sendResponse(res, null, "Invalid verification code", 400);

      // --- ACTIVATE 2FA AFTER SUCCESSFUL VERIFICATION ---
      const secret = decrypt(user.twoFactor.tempSecret);
      user.twoFactor.secret = encrypt(secret);
      user.twoFactor.tempSecret = "";
      user.twoFactor.tempOTP = null;
      user.twoFactor.enabled = true;           // <-- changed here: enable only after verification
      user.twoFactorVerified = true;           // <-- user now verified

      // --- Generate backup codes ---
      const backupCodes = generateBackupCodes(8);
      user.twoFactor.backupCodes = await hashBackupCodes(backupCodes);

      await user.save();

      const accessToken = generateAccessToken({
        id: user._id,
        role: user.role,
        twoFactorVerified: true,
      });

      return sendResponse(
        res,
        { token: accessToken, backupCodes, user },
        "2FA setup verified successfully",
        200
      );
    }

    return sendResponse(
      res,
      null,
      "No 2FA process in progress (neither setup nor login)",
      400
    );

  } catch (err) {
    console.log(err);
    sendResponse(res, null, "Server error", 500);
  }
};

// ======================== DISABLE 2FA ========================
export const disable2FA = async (req: any, res: Response) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendResponse(res, null, "User not found", 404);

    user.twoFactor.enabled = false;
    user.twoFactor.secret = "";
    user.twoFactor.tempSecret = "";
    user.twoFactor.tempOTP = null;
    user.twoFactor.backupCodes = [];
    user.twoFactorVerified = false;  // <-- reset verification flag

    await user.save();

    sendResponse(res, null, "2FA disabled", 200);
  } catch (err) {
    sendResponse(res, null, "Server error", 500);
  }
};













// // POST /2fa/enable
// export const enable2FA_Flag = async (req: any, res: Response) => {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendResponse(res, null, "Unauthorized", 401);

//     const user = await User.findById(userId);
//     if (!user) return sendResponse(res, null, "User not found", 404);

//     // Enable 2FA flag but not verified yet
//     user.twoFactor.enabled = true;      // 2FA switched on
//     user.twoFactorVerified = false;     // still not verified
//     await user.save();

//     sendResponse(res, { twoFactor: user.twoFactor }, "2FA enabled. Please complete setup.", 200);
//   } catch (err) {
//     console.log(err);
//     sendResponse(res, null, "Server error", 500);
//   }
// };

// // Step 1 — generate temp secret + send email OTP
// export const enable2FA_Start = async (req: any, res: Response) => {
//   try {
//     const userId = req.user?.id;

//     const user = await User.findById(userId);
//     if (!user) return sendResponse(res, null, "User not found", 404);

//     // 1) Generate secret + QR
//     const secret = await generateTempSecret(user.name, user.email);
//     user.twoFactor.tempSecret = encrypt(secret.base32);

//     // 2) Generate 6-digit setup OTP
//     const setupOTP = Math.floor(100000 + Math.random() * 900000).toString();

//     user.twoFactor.tempOTP = {
//       code: setupOTP,
//       expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 min expiry
//     };

//     await user.save();

//     // 3) Send OTP to email
//     await sendEmail({
//       to: user.email,
//       name: user.name,
//       subject: "Your 2FA Setup Verification Code",
//       content: `Your setup verification code is: ${setupOTP}. It expires in 5 minutes.`
//     });

//     sendResponse(
//       res,
//       { requireVerification: true },
//       "2FA setup started. Verification code sent to email.",
//       200
//     );
//   } catch (err) {
//     console.log(err);
//     sendResponse(res, null, "Server error", 500);
//   }
// };

// // ==================== VERIFY 2FA ====================
// export const verify2FA = async (req: any, res: Response) => {
//   try {
//     const { token } = req.body;
//     const userId = req.user?.id;

//     if (!token) {
//       return sendResponse(res, null, "2FA code is required", 400);
//     }

//     const user = await User.findById(userId);
//     if (!user) return sendResponse(res, null, "User not found", 404);

//     // ------------------ LOGIN VERIFICATION ------------------
//     if (user.twoFactor.loginCode && user.twoFactor.loginExpiry) {
//       if (user.twoFactor.loginExpiry < new Date())
//         return sendResponse(res, null, "2FA login code expired", 400);

//       if (user.twoFactor.loginCode !== token)
//         return sendResponse(res, null, "Invalid 2FA login code", 400);

//       // Clear loginCode
//       user.twoFactor.loginCode = null;
//       user.twoFactor.loginExpiry = null;
//       await user.save();

//       // ---------- GENERATE FULL TOKEN AFTER SUCCESS ----------
//       const accessToken = generateAccessToken({
//         id: user._id,
//         role: user.role,
//         twoFactorVerified: true, // <--- Added flag after 2FA verification
//       });

//       return sendResponse(
//         res,
//         { token: accessToken, user },
//         "Login successful",
//         200
//       );
//     }

//     // ------------------ SETUP VERIFICATION ------------------
//     if (user.twoFactor.tempOTP && user.twoFactor.tempSecret) {
//       const temp = user.twoFactor.tempOTP;

//       if (temp.expiresAt < new Date())
//         return sendResponse(res, null, "Verification code expired", 400);

//       if (temp.code !== token)
//         return sendResponse(res, null, "Invalid verification code", 400);

//       // --- Activate 2FA setup ---
//       const secret = decrypt(user.twoFactor.tempSecret);

//       user.twoFactor.enabled = true;
//       user.twoFactor.secret = encrypt(secret);
//       user.twoFactor.tempSecret = "";
//       user.twoFactor.tempOTP = null;

//       // --- Generate backup codes ---
//       const backupCodes = generateBackupCodes(8);
//       user.twoFactor.backupCodes = await hashBackupCodes(backupCodes);
//       user.twoFactorVerified = true;

//       await user.save();

//       // ---------- GENERATE FULL AUTH TOKEN FOR FIRST-TIME 2FA ----------
//       const accessToken = generateAccessToken({
//         id: user._id,
//         role: user.role,
//         twoFactorVerified: true, // <--- New token payload flag
//       });

//       // --- Return token along with backup codes ---
//       return sendResponse(
//         res,
//         { token: accessToken, backupCodes, user },
//         "2FA setup verified successfully",
//         200
//       );
//     }

//     // ------------------ NO 2FA IN PROGRESS ------------------
//     return sendResponse(
//       res,
//       null,
//       "No 2FA process in progress (neither setup nor login)",
//       400
//     );

//   } catch (err) {
//     console.log(err);
//     sendResponse(res, null, "Server error", 500);
//   }
// };

// // Disable 2FA
// export const disable2FA = async (req: any, res: Response) => {
//   try {
//     const user = await User.findById(req.user.id);
//     if (!user) return sendResponse(res, null, "User not found", 404);

//     user.twoFactor.enabled = false;
//     user.twoFactor.secret = "";
//     user.twoFactor.tempSecret = "";
//     user.twoFactor.backupCodes = [];

//     await user.save();

//     sendResponse(res, null, "2FA disabled", 200);
//   } catch (err) {
//     sendResponse(res, null, "Server error", 500);
//   }
// };
