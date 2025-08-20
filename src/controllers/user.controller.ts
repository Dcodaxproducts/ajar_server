import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { IUser, User } from "../models/user.model";
import { Form } from "../models/form.model";
import {
  generateAccessToken,
  generateResetToken,
  verifyRefreshToken,
} from "../utils/jwt.utils";
import { sendEmail } from "../helpers/node-mailer";
import { createCustomer } from "../helpers/stripe-functions";
import { redis } from "../utils/redis.client";
import { generateZodSchema } from "../utils/generate-zod-schema";
import { UserDocument } from "../models/userDocs.mode";
import { Category } from "../models/category.model";
import { Booking } from "../models/booking.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { Employee } from "../models/employeeManagement.model";
import { Zone } from "../models/zone.model";

export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name, dob, nationality, user_type } = req.body;
    const user = await User.findOne({ email }).select("email").lean();
    if (user) {
      sendResponse(
        res,
        { email },
        "User already exists",
        STATUS_CODES.CONFLICT
      );
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

    // if (profilePicture) {
    //   userData.profilePicture = `/uploads/${profilePicture.filename}`;
    // }

    if (profilePicture) {
      userData.profilePicture = `${req.protocol}://${req.get("host")}/uploads/${
        profilePicture.filename
      }`;
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

  try {
    if (role === "staff") {
      // Staff login using Employee model with plain password
      const employee = await Employee.findOne({ email })
        .select("email password roles")
        .lean();

      if (!employee) {
        sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
        return;
      }

      if (employee.password !== password) {
        sendResponse(
          res,
          null,
          "Invalid email or password",
          STATUS_CODES.UNAUTHORIZED
        );
        return;
      }

      const accessToken = generateAccessToken({
        id: employee._id,
        role: "staff",
      });

      sendResponse(
        res,
        {
          token: accessToken,
          user: employee,
        },
        "Login successful (staff)",
        STATUS_CODES.OK
      );
    } else if (role === "user" || role === "admin") {
      // User/Admin login using User model with bcrypt
      const user = await User.findOne({ email, role })
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

      const accessToken = generateAccessToken({
        id: user._id,
        role: user.role,
      });

      sendResponse(
        res,
        {
          token: accessToken,
          user: user,
        },
        "Login successful",
        STATUS_CODES.OK
      );
    } else {
      sendResponse(
        res,
        null,
        "Invalid role provided",
        STATUS_CODES.BAD_REQUEST
      );
    }
  } catch (error) {
    next(error);
  }
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
    refreshTokens.delete(refreshToken);
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
  refreshTokens.delete(refreshToken);

  sendResponse(res, null, "Logged out successfully", STATUS_CODES.OK);
};

// Assuming your AuthRequest extends Express Request and adds a `user` object
interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string | string[]; // Allow both string and string[] formats
  };
}

export const getUserDetails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || !role) {
      sendResponse(
        res,
        null,
        "User not authenticated",
        STATUS_CODES.UNAUTHORIZED
      );
      return;
    }

    let user: any = null;

    // Helper function to check role existence
    const hasRole = (r: string): boolean =>
      Array.isArray(role) ? role.includes(r) : role === r;

    if (hasRole("admin") || hasRole("user")) {
      user = await User.findById(userId).select("email name role").lean();
    } else if (hasRole("staff")) {
      user = await Employee.findById(userId)
        .select("email firstName lastName role")
        .lean();

      if (user) {
        // Combine firstName and lastName into a name field for consistency
        user.name = `${user.firstName} ${user.lastName}`;
        delete user.firstName;
        delete user.lastName;
      }
    } else {
      sendResponse(res, null, "Invalid role", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Fetch attached documents
    const docsAttached = await UserDocument.find({
      user: userId,
    }).lean();

    sendResponse(
      res,
      {
        user,
        documents: docsAttached,
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
    const { password } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      sendResponse(res, null, "Unauthorized", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    const user = await User.findById(userId);

    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;

    // clear reset OTP fields (optional if you use OTP flow)
    user.otp.resetToken = "";
    user.otp.resetTokenExpiry = new Date(0);

    await user.save();

    sendResponse(res, null, "Password reset successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// Get all users and user statistics in a single API.

// Embedded pagination logic directly inside the controller
const paginateQuery = async <T>(
  query: import("mongoose").Query<T[], any>,
  options: { page?: number; limit?: number } = {}
): Promise<{ data: T[]; total: number; page: number; limit: number }> => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, options.limit || 10);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    query.clone().skip(skip).limit(limit).exec(),
    query.clone().countDocuments().exec(),
  ]);

  return { data, total, page, limit };
};

export const getAllUsersWithStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const role = req.query.role;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const filter: { role?: string } = {};
    if (role && typeof role === "string") {
      filter.role = role;
    }

    // Exclude admin from the user list (but not from global stats)
    const userFilter = { ...filter, role: { $ne: "admin" } };

    const userQuery = User.find(userFilter)
      .lean()
      .select("email name phone status");

    const { data: users } = await paginateQuery(userQuery, { page, limit });

    // Filtered total for pagination (not global)
    const filteredTotal = await User.countDocuments(userFilter);

    // Global user statistics
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: "admin" });

    const totalActiveUsers = await User.countDocuments({ status: "active" });
    const totalInactiveUsers = await User.countDocuments({
      status: "inactive",
    });
    const totalBlockedUsers = await User.countDocuments({ status: "blocked" });

    sendResponse(
      res,
      {
        users,
        pagination: {
          total: filteredTotal,
          page,
          limit,
        },
        stats: {
          totalUsers,
          totalAdmins,
          totalActiveUsers,
          totalInactiveUsers,
          totalBlockedUsers,
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
  } catch (error) {
    next(error);
  }
};

// GET DASHBOARD STATS (Admin)
export const getDashboardStats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const now = new Date();

    const filter = req.query.filter as string;
    let filterDate: Date | null = null;

    if (filter === "week") {
      filterDate = new Date();
      filterDate.setDate(now.getDate() - 7);
    } else if (filter === "month") {
      filterDate = new Date();
      filterDate.setDate(now.getDate() - 28);
    } else if (filter === "year") {
      filterDate = new Date();
      filterDate.setFullYear(now.getFullYear() - 1);
    } else if (filter) {
      sendResponse(
        res,
        null,
        "Invalid filter. Use 'week', 'month', or 'year'.",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const [totalUsers, totalAdmins, totalNormalUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "user" }),
    ]);

    const [totalMarketplaceListings, uniqueUserIds] = await Promise.all([
      MarketplaceListing.countDocuments(),
      MarketplaceListing.distinct("user"),
    ]);
    const totalLeasers = uniqueUserIds.length;

    const totalCategories = await Category.countDocuments({ type: "category" });
    const totalZones = await Zone.countDocuments();

    let bookingFilter = {};
    if (filterDate) {
      bookingFilter = { createdAt: { $gte: filterDate, $lte: now } };
    }

    const filteredBookings = await Booking.find(bookingFilter).lean();
    const bookingCount = filteredBookings.length;

    const totalEarning = filteredBookings.reduce((acc, booking) => {
      const price = booking.priceDetails?.totalPrice || 0;
      const extension = booking.extensionCharges?.totalPrice || 0;
      return acc + price + extension;
    }, 0);

    const userRecords: any[] = [];
    const earningRecords: any[] = [];

    if (filter === "week") {
      for (let i = 6; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(now.getDate() - i);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);

        const [users, bookings] = await Promise.all([
          User.countDocuments({ createdAt: { $gte: start, $lte: end } }),
          Booking.find({ createdAt: { $gte: start, $lte: end } }).lean(),
        ]);

        const dailyEarning = bookings.reduce((acc, booking) => {
          const price = booking.priceDetails?.totalPrice || 0;
          const extension = booking.extensionCharges?.totalPrice || 0;
          return acc + price + extension;
        }, 0);

        userRecords.push({ value: `${7 - i}`, totalUsers: users });
        earningRecords.push({ value: `${7 - i}`, totalEarning: dailyEarning });
      }
    }

    if (filter === "month") {
      for (let i = 3; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(now.getDate() - i * 7);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        const [users, bookings] = await Promise.all([
          User.countDocuments({ createdAt: { $gte: start, $lte: end } }),
          Booking.find({ createdAt: { $gte: start, $lte: end } }).lean(),
        ]);

        const weeklyEarning = bookings.reduce((acc, booking) => {
          const price = booking.priceDetails?.totalPrice || 0;
          const extension = booking.extensionCharges?.totalPrice || 0;
          return acc + price + extension;
        }, 0);

        userRecords.push({ value: `${4 - i}`, totalUsers: users });
        earningRecords.push({ value: `${4 - i}`, totalEarning: weeklyEarning });
      }
    }

    let userTrend: { value: string; trend: string };
    let earningTrend: { value: string; trend: string };

    if (filter === "year") {
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(
          start.getFullYear(),
          start.getMonth() + 1,
          0,
          23,
          59,
          59,
          999
        );

        const [users, bookings] = await Promise.all([
          User.countDocuments({ createdAt: { $gte: start, $lte: end } }),
          Booking.find({ createdAt: { $gte: start, $lte: end } }).lean(),
        ]);

        const monthlyEarning = bookings.reduce((acc, booking) => {
          const price = booking.priceDetails?.totalPrice || 0;
          const extension = booking.extensionCharges?.totalPrice || 0;
          return acc + price + extension;
        }, 0);

        userRecords.push({ value: `${12 - i}`, totalUsers: users });
        earningRecords.push({
          value: `${12 - i}`,
          totalEarning: monthlyEarning,
        });
      }

      // Calculate current vs previous year total
      const currentYear = now.getFullYear();
      const previousYear = currentYear - 1;

      const [prevUserDocs, prevBookings] = await Promise.all([
        User.countDocuments({
          createdAt: {
            $gte: new Date(previousYear, 0, 1),
            $lte: new Date(previousYear, 11, 31, 23, 59, 59, 999),
          },
        }),
        Booking.find({
          createdAt: {
            $gte: new Date(previousYear, 0, 1),
            $lte: new Date(previousYear, 11, 31, 23, 59, 59, 999),
          },
        }).lean(),
      ]);

      const prevTotalUsers = prevUserDocs;
      const prevTotalEarning = prevBookings.reduce((acc, booking) => {
        const price = booking.priceDetails?.totalPrice || 0;
        const extension = booking.extensionCharges?.totalPrice || 0;
        return acc + price + extension;
      }, 0);

      const currTotalUsers = userRecords.reduce(
        (acc, cur) => acc + cur.totalUsers,
        0
      );
      const currTotalEarning = earningRecords.reduce(
        (acc, cur) => acc + cur.totalEarning,
        0
      );

      const calcTrend = (current: number, previous: number) => {
        const diff = current - previous;
        const trend = diff >= 0 ? "up" : "down";
        const percentage =
          previous === 0
            ? current > 0
              ? 100
              : 0
            : Math.abs(Math.round((diff / previous) * 100));
        return { value: `${percentage}`, trend };
      };

      userTrend = calcTrend(currTotalUsers, prevTotalUsers);
      earningTrend = calcTrend(currTotalEarning, prevTotalEarning);
    } else {
      const calcTrend = (current: number, previous: number) => {
        const diff = current - previous;
        const trend = diff >= 0 ? "up" : "down";
        const percentage =
          previous === 0
            ? current > 0
              ? 100
              : 0
            : Math.abs(Math.round((diff / previous) * 100));
        return { value: `${percentage}`, trend };
      };

      userTrend =
        userRecords.length >= 2
          ? calcTrend(
              userRecords[userRecords.length - 1].totalUsers,
              userRecords[userRecords.length - 2].totalUsers
            )
          : { value: "0", trend: "up" };

      earningTrend =
        earningRecords.length >= 2
          ? calcTrend(
              earningRecords[earningRecords.length - 1].totalEarning,
              earningRecords[earningRecords.length - 2].totalEarning
            )
          : { value: "0", trend: "up" };
    }

    sendResponse(
      res,
      {
        filter,
        stats: {
          totalUsers,
          totalAdmins,
          totalNormalUsers,
          totalLeasers,
          totalMarketplaceListings,
          totalCategories,
          totalZones,
          bookingCount,
          totalEarning,
        },
        charts: {
          users: {
            change: userTrend,
            record: userRecords,
          },
          earnings: {
            change: earningTrend,
            record: earningRecords,
          },
        },
      },
      "Dashboard statistics fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// In user.controller.ts
export const updateUserStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (typeof req.user?.role === "string" && req.user.role !== "admin") {
      sendResponse(res, null, "Forbidden: Admins only", STATUS_CODES.FORBIDDEN);
      return;
    }

    const { userId } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["active", "inactive", "blocked", "Unblocked"];
    if (!allowedStatuses.includes(status)) {
      sendResponse(res, null, "Invalid status value", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    user.status = status;
    await user.save();

    sendResponse(
      res,
      user,
      "User status updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

//delete user
export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Only admin can delete users
    if (typeof req.user?.role === "string" && req.user.role !== "admin") {
      sendResponse(res, null, "Forbidden: Admins only", STATUS_CODES.FORBIDDEN);
      return;
    }

    const { userId } = req.params;

    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, null, "User deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
