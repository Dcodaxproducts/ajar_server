import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { IUser, User } from "../models/user.model";
import { Form } from "../models/form.model";
import {
  generateAccessToken,
  generateResetToken,
  verifyRefreshToken,
} from "../utils/jwt.utils";
import { AuthRequest } from "../types/express";
import { sendEmail } from "../helpers/node-mailer";
import { createCustomer } from "../helpers/stripe-functions";
import { redis } from "../utils/redis.client";
import { generateZodSchema } from "../utils/generate-zod-schema";
import { UserDocument } from "../models/userDocs.mode";

export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name, dob, nationality, user_type } = req.body;
    const user = await User.findOne({ email }).select("email").lean();
    if (user) {
      sendResponse(res, req.body, "User already exists", STATUS_CODES.CONFLICT);
      return;
    }

    const profilePicture = req.file;

    const hashedPassword = await bcrypt.hash(password, 10);
    const userData = new User({
      email,
      password: hashedPassword,
      name,
      dob,
      nationality,
      role: user_type,
    });

    const stripeCustomer = await createCustomer(email, name);
    userData.stripe.customerId = stripeCustomer.id;

    if (profilePicture) {
      userData.profilePicture = `/uploads/${profilePicture.filename}`;
    }

    const userObj = userData.toObject();
    const { password: _, ...userWithoutPassword } = userObj;

    const otp = Math.floor(1000 + Math.random() * 9000);
    userData.otp.code = otp.toString();
    userData.otp.expiry = new Date(Date.now() + 5 * 60 * 1000);
    await userData.save();
    await sendEmail({
      to: email,
      name: userData.name,
      subject: "Your OTP Code",
      content: `Your OTP is: ${otp}`,
    });

    sendResponse(
      res,
      { user: userWithoutPassword },
      "User created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

//login
const refreshTokens: Set<string> = new Set();

export const loginUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { email, password, role } = req.body;

  const user = await User.findOne({ email })
    .select("email password role")
    .lean();
  if (!user) {
    sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    sendResponse(
      res,
      null,
      "Invalid email or password",
      STATUS_CODES.UNAUTHORIZED
    );
    return;
  }

  const accessToken = generateAccessToken({ id: user._id, role: user.role });
  // const refreshToken = generateRefreshToken({ id: user._id }, "7d");

  // refreshTokens.add(refreshToken); // Store refresh token (DB recommended)

  sendResponse(
    res,
    {
      token: accessToken,
      user: user,
    },
    "Login successful",
    STATUS_CODES.OK
  );
};

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { refreshToken } = req.body;
  if (!refreshToken || !refreshTokens.has(refreshToken)) {
    sendResponse(
      res,
      null,
      "Unauthorized: Invalid or expired refresh token",
      STATUS_CODES.UNAUTHORIZED
    );
    return;
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    refreshTokens.delete(refreshToken); // Remove expired token
    sendResponse(
      res,
      null,
      "Session expired. Please log in again.",
      STATUS_CODES.UNAUTHORIZED
    );
    return;
  }

  const newAccessToken = generateAccessToken({
    id: decoded.id,
    email: decoded.email,
  });

  sendResponse(
    res,
    { accessToken: newAccessToken },
    "Token refreshed successfully",
    STATUS_CODES.OK
  );
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { refreshToken } = req.body;
  refreshTokens.delete(refreshToken); // Remove refresh token from store

  sendResponse(res, null, "Logged out successfully", STATUS_CODES.OK);
};

export const getUserDetails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log({ user: req.user });
    const userId = req.user?.id;

    const user = await User.findById(userId).select("email name role").lean();
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // get all my bookings
    // const bookings = await Booking.find({ user: userId }).lean();

    const docsAttached = await UserDocument.find({
      user: userId,
    }).lean();

    sendResponse(
      res,
      {
        user,
        documents: docsAttached,
        // bookings,
      },
      "User details fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const resendOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const otp = Math.floor(1000 + Math.random() * 9000);
    user.otp.isVerified = false;
    user.otp.code = otp.toString();
    user.otp.expiry = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();
    await sendEmail({
      to: email,
      name: user.name,
      subject: "Your OTP Code",
      content: `Your OTP is: ${otp}`,
    });

    sendResponse(res, null, "OTP sent successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (
      !user ||
      user.otp.code !== otp ||
      user.otp.expiry.getTime() < Date.now()
    ) {
      sendResponse(
        res,
        null,
        "Invalid or expired OTP",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    user.otp.isVerified = true;
    user.otp.code = "";
    user.otp.expiry = new Date(0);
    await user.save();

    const accessToken = generateAccessToken({ id: user._id, role: user.role });
    const userWithoutPassword = user.toObject();
    const { password: _, ...userWithoutPasswordDetails } = userWithoutPassword;

    sendResponse(
      res,
      {
        token: accessToken,
        user: userWithoutPasswordDetails,
      },
      "OTP verified successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const resetToken = generateResetToken({ id: user._id });
    user.otp.resetToken = resetToken;
    user.otp.resetTokenExpiry = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    await sendEmail({
      to: email,
      name: user.name,
      subject: "Reset Your Password",
      content: `
      <p style="color: #555;">Use the token below to reset your password:</p>
      <div style="background: #f4f4f4; padding: 10px; color: green; border-radius: 5px; border: 1px solid #ccc; display: inline-block;" id="token">${resetToken}</div>
      <p style="text-align: center;">
    `,
    });

    sendResponse(
      res,
      {
        resetToken,
        resetTokenExpiry: user.otp.resetTokenExpiry,
        userId: user._id,
      },
      "Password reset token sent",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { resetToken, password } = req.body;
    const user = await User.findOne({
      "otp.resetToken": resetToken,
      "otp.resetTokenExpiry": { $gt: Date.now() },
    });

    if (!user) {
      sendResponse(
        res,
        null,
        "Invalid or expired reset token",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.otp.resetToken = "";
    user.otp.resetTokenExpiry = new Date(0);
    await user.save();

    sendResponse(res, null, "Password reset successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
/**
 * Get all users and user statistics in a single API.
 */
export const getAllUsersWithStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const role = req.query.role;
    const filter: { role?: string } = {};
    if (role && typeof role === "string") {
      filter.role = role;
    }

    const users = await User.find(filter).lean().select("email name role");

    // User statistics
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: "admin" });
    const totalNormalUsers = await User.countDocuments({ role: "user" });
    const total = totalAdmins + totalNormalUsers;

    sendResponse(
      res,
      {
        users,
        stats: {
          totalUsers,
          totalAdmins,
          totalNormalUsers,
          total,
        },
      },
      "Users and statistics fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const updateUserProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { name, phone } = req.body;
    const profilePicture = req.file;

    const user = await User.findById(userId);
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (profilePicture) {
      user.profilePicture = `/uploads/${profilePicture.filename}`;
    }

    user.name = name || user.name;
    user.phone = phone || user.phone;

    await user.save();

    sendResponse(res, user, "Profile updated successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// add dynamic form

export const addForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { title, fields } = req.body;

    const formSchema = generateZodSchema(fields);

    const schemaJson = formSchema._def;

    const form = new Form({
      title,
      fields,
      schema: schemaJson,
    });

    await form.save();

    // const form = await Form.findById("67d7f95824a727c9f53263ec");

    // if (!form) {
    //   sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
    //   return;
    // }
  } catch (error) {
    next(error);
  }
};
