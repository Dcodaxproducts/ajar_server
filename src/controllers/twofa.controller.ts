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
    if (!userId) return sendResponse(res, null, req.t("common:unauthorized"), 401);

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, req.t("user:notFound"), 404);

    // Do NOT enable fully yet; user must verify first
    user.twoFactor.enabled = false;  
    user.twoFactorVerified = false;     
    await user.save();

    sendResponse(res, { twoFactor: user.twoFactor }, req.t("twofa:flagEnabled"), 200);
  } catch (err) {
    sendResponse(res, null, req.t("common:serverError"), 500);
  }
};

// ======================== START 2FA SETUP ========================
export const enable2FA_Start = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, req.t("user:notFound"), 404);

    // 1) Generate temp secret
    const secret = await generateTempSecret(user.name, user.email);
    user.twoFactor.tempSecret = encrypt(secret.base32);

    // 2) Generate 6-digit setup OTP
    const setupOTP = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactor.tempOTP = {
      code: setupOTP,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };

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
      req.t("twofa:setupStarted"),
      200
    );
  } catch (err) {
    sendResponse(res, null, req.t("common:serverError"), 500);
  }
};

// ======================== VERIFY 2FA ========================
export const verify2FA = async (req: any, res: Response) => {
  try {
    const { token } = req.body;
    const userId = req.user?.id;

    if (!token) {
      return sendResponse(res, null, req.t("twofa:codeRequired"), 400);
    }

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, req.t("user:notFound"), 404);

    // ------------------ LOGIN VERIFICATION ------------------
    if (user.twoFactor.loginCode && user.twoFactor.loginExpiry) {
      if (user.twoFactor.loginExpiry < new Date())
        return sendResponse(res, null, req.t("twofa:loginCodeExpired"), 400);

      if (user.twoFactor.loginCode !== token)
        return sendResponse(res, null, req.t("twofa:invalidLoginCode"), 400);

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
        req.t("user:auth.loginSuccess"),
        200
      );
    }

    // ------------------ SETUP VERIFICATION ------------------
    if (user.twoFactor.tempOTP && user.twoFactor.tempSecret) {
      const temp = user.twoFactor.tempOTP;

      if (temp.expiresAt < new Date())
        return sendResponse(res, null, req.t("twofa:verificationCodeExpired"), 400);

      if (temp.code !== token)
        return sendResponse(res, null, req.t("twofa:invalidVerificationCode"), 400);

      // --- ACTIVATE 2FA AFTER SUCCESSFUL VERIFICATION ---
      const secret = decrypt(user.twoFactor.tempSecret);
      user.twoFactor.secret = encrypt(secret);
      user.twoFactor.tempSecret = "";
      user.twoFactor.tempOTP = null;
      user.twoFactor.enabled = true;   
      user.twoFactorVerified = true;  

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
        req.t("twofa:setupVerified"),
        200
      );
    }

    return sendResponse(
      res,
      null,
      req.t("twofa:noProcessInProgress"),
      400
    );

  } catch (err) {
    sendResponse(res, null, req.t("common:serverError"), 500);
  }
};

// ======================== DISABLE 2FA ========================
export const disable2FA = async (req: any, res: Response) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendResponse(res, null, req.t("user:notFound"), 404);

    user.twoFactor.enabled = false;
    user.twoFactor.secret = "";
    user.twoFactor.tempSecret = "";
    user.twoFactor.tempOTP = null;
    user.twoFactor.backupCodes = [];
    user.twoFactorVerified = false; 

    await user.save();

    sendResponse(res, null, req.t("twofa:disabled"), 200);
  } catch (err) {
    sendResponse(res, null, req.t("common:serverError"), 500);
  }
};
