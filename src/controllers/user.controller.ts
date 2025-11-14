import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { IUserDocument, User } from "../models/user.model";
import { Form } from "../models/form.model";
import {
  generateAccessToken,
  generateResetToken,
  verifyRefreshToken,
} from "../utils/jwt.utils";
import { sendEmail } from "../helpers/node-mailer";
import { createCustomer } from "../helpers/stripe-functions";
import { generateZodSchema } from "../utils/generate-zod-schema";
import { UserDocument } from "../models/userDocs.model";
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

  try {
    if (role === "staff") {
      const employee = await Employee.findOne({ email })
        .populate({
          path: "allowAccess",
          select: "-__v",
        })
        .select("-__v")
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
      const user = await User.findOne({ email, role })
        .select("-password")
        .lean();

      if (!user) {
        sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        password,
        (await User.findOne({ email, role }))?.password || ""
      );
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

interface AuthRequest extends Request {
  user?: {
    _id: string;
    id?: string;
    role: string | string[];
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
      // Get all user details except password
      user = await User.findById(userId).select("-password").lean();
    } else if (hasRole("staff")) {
      // Get all staff details with populated role information - EXACTLY like login
      user = await Employee.findById(userId)
        .populate({
          path: "allowAccess",
          select: "-__v",
        })
        .select("-__v")
        .lean();

      if (user) {
        // Add role field for consistency with user response
        user.role = "staff";

        // Check if name already exists (from the database)
        if (!user.name) {
          if (user.firstName && user.lastName) {
            user.name = `${user.firstName} ${user.lastName}`;
          } else if (user.firstName) {
            user.name = user.firstName;
          } else if (user.lastName) {
            user.name = user.lastName;
          }
        }
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

    // Generate new OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    user.otp = {
      code: otp,
      expiry: new Date(Date.now() + 5 * 60 * 1000),
      isVerified: false,
    };
    await user.save();

    await sendEmail({
      to: email,
      name: user.name,
      subject: "Your New OTP Code",
      content: `
        <p>Hello ${user.name || "User"},</p>
        <p>Your new OTP is:</p>
        <div style="background: #f4f4f4; padding: 10px; color: #2e7d32; border-radius: 5px; border: 1px solid #ccc; display: inline-block;">
          <strong>${otp}</strong>
        </div>
        <p>This OTP will expire in 5 minutes.</p>
      `,
    });

    sendResponse(res, null, "OTP resent successfully", STATUS_CODES.OK);
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
      sendResponse(res, null, "Invalid or expired OTP", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Mark OTP as verified
    user.otp.isVerified = true;
    await user.save();

    const accessToken = generateAccessToken({ id: user._id, role: user.role });

    sendResponse(
      res,
      {
        token: accessToken,
        userId: user._id,
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
    const email = req.body.email?.trim();

    // Check if user exists
    const user = await User.findOne({ email: { $regex: `^${email}$`, $options: "i" } });
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Generate a 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Save OTP and expiry (5 minutes)
    user.otp = {
      code: otp,
      expiry: new Date(Date.now() + 5 * 60 * 1000),
      isVerified: false,
    };
    await user.save();

    // Send OTP via email
    await sendEmail({
      to: email,
      name: user.name,
      subject: "Your Password Reset OTP",
      content: `
        <p>Hello ${user.name || "User"},</p>
        <p>Your OTP for password reset is:</p>
        <div style="background: #f4f4f4; padding: 10px; color: #2e7d32; border-radius: 5px; border: 1px solid #ccc; display: inline-block;">
          <strong>${otp}</strong>
        </div>
        <p>This OTP will expire in 5 minutes.</p>
      `,
    });

    sendResponse(
      res,
      {
        email: user.email,
        otpExpiry: user.otp.expiry,
      },
      "OTP sent to your email",
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
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Ensure OTP was verified
    if (!user.otp.isVerified) {
      sendResponse(res, null, "OTP not verified", STATUS_CODES.FORBIDDEN);
      return;
    }

    // Hash and save new password
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;

    // Clear OTP fields
    user.otp = {
      code: "",
      expiry: new Date(0),
      isVerified: false,
    };

    await user.save();

    sendResponse(res, null, "Password reset successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

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
    if (!userId) {
      sendResponse(res, null, "User not authenticated", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    const updates: any = { ...req.body };
    const user = await User.findById(userId);
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Handle uploaded files (any field name)
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files as Express.Multer.File[]) {
        const fieldId = file.fieldname; // the admin-defined field name
        const uploadedFile = {
          url: `/uploads/${file.filename}`, // adapt if using S3/Firebase
          side: "single",
          status: "pending",
        };

        // Check if document with same field exists
        const existingDocIndex = user.documents.findIndex(d => d.name === fieldId);
        if (existingDocIndex >= 0) {
          user.documents[existingDocIndex].filesUrl.push(uploadedFile.url);
        } else {
          user.documents.push({
            name: fieldId,
            filesUrl: [uploadedFile.url],
            status: "pending",
          });
        }
      }
    }

    // Update other profile fields
    Object.assign(user, updates);

    const updatedUser = await user.save();
    const { password, ...userWithoutPassword } = updatedUser.toObject();

    sendResponse(
      res,
      userWithoutPassword,
      "Profile updated successfully",
      STATUS_CODES.OK
    );
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
      const extension = booking.extraRequestCharges?.totalPrice || 0;
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
          const extension = booking.extraRequestCharges?.totalPrice || 0;
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
          const extension = booking.extraRequestCharges?.totalPrice || 0;
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
          const extension = booking.extraRequestCharges?.totalPrice || 0;
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
        const extension = booking.extraRequestCharges?.totalPrice || 0;
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

    const allowedStatuses = ["active", "inactive", "blocked", "unblocked"];
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

// for documents get dropdown
import { Dropdown } from "../models/dropdown.model";

export const getUserDocuments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const docs = await Dropdown.findOne({ name: "userDocuments" }).lean();
    const values = docs?.values ?? [];
    sendResponse(res, values, "User documents fetched", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

export const getListingDocuments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const docs = await Dropdown.findOne({ name: "listingDocuments" }).lean();
    const values = docs?.values ?? [];
    sendResponse(res, values, "Listing documents fetched", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};


//socail logins 
// Controller: Google Login
// import { OAuth2Client, LoginTicket  } from "google-auth-library";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

//  Initialize Firebase Admin once
if (!admin.apps.length) {
  const serviceAccount = require("../config/ajar-48a79-firebase-adminsdk-fbsvc-50588602d0.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const googleLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { idToken, platform } = req.body;

    // Validate Firebase token input
    if (!idToken) {
      sendResponse(res, null, "Missing Firebase ID token", STATUS_CODES.BAD_REQUEST);
      return;
    }

    //  Verify Firebase token with Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log("Firebase decoded token:", decodedToken);

    const { email, name, picture, uid } = decodedToken;

    if (!email) {
      sendResponse(res, null, "Email not found in Firebase token", STATUS_CODES.BAD_REQUEST);
      return;
    }

    //  Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      const hashedPassword = await bcrypt.hash("firebase-login", 10);

      user = new User({
        email,
        password: hashedPassword,
        name: name || "Google User",
        role: "user",
        otp: { isVerified: true },
        profilePicture: picture || "",
        firebaseUid: uid,
      });

      // Optional: Stripe customer
      const stripeCustomer = await createCustomer(email, name);
      if (stripeCustomer?.id) {
        user.stripe = {
          customerId: stripeCustomer.id,
          subscriptionId: "",
          connectedAccountId: "",
          connectedAccountLink: "",
        };
      }

      await user.save();

      // Optional: Welcome email
      await sendEmail({
        to: email,
        name,
        subject: "Welcome to our App",
        content: `Hi ${name || "there"}, your account has been created via Google (Firebase) login.`,
      });
    }

    // Generate Access Token using your util (same as loginUser)
    const accessToken = generateAccessToken({
      id: user._id,
      role: user.role,
    });

    console.log("Access Token:", accessToken);

    // Send success response
    sendResponse(
      res,
      {
        token: accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.profilePicture,
          provider: "google",
          platform: platform || "mobile",
        },
      },
      "Firebase Google login successful",
      STATUS_CODES.OK
    );
  } catch (error) {
    console.error("Firebase Google login error:", error);
    next(error);
  }
};









//this is for googleoauth login {

// dotenv.config();

// const googleClient = new OAuth2Client();


 //Google Login Controller

// Safely define allowed Google OAuth client IDs
// const ALLOWED_AUDIENCES = new Set(
//   [

//     process.env.GOOGLE_ANDROID_CLIENT_ID,
//     process.env.GOOGLE_IOS_CLIENT_ID,
//   ].filter((id): id is string => Boolean(id))
// );

// export const googleLogin = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const { idToken, platform } = req.body;

//     //1. Validate request
//     if (!idToken) {
//       sendResponse(res, null, "Missing Google ID token", STATUS_CODES.BAD_REQUEST);
//       return;
//     }

//     //2. Verify Google ID token
//     const ticket: LoginTicket = await googleClient.verifyIdToken({
//       idToken,
//       audience: Array.from(ALLOWED_AUDIENCES),
//     });
//     console.log("Google login ticket:", ticket);

//     const payload = ticket.getPayload();
//     if (!payload) {
//       sendResponse(res, null, "Invalid token", STATUS_CODES.UNAUTHORIZED);
//       return;
//     }
//     console.log("Google login payload:", payload);

//     //3. Check valid audience
//     if (!ALLOWED_AUDIENCES.has(payload.aud)) {
//       sendResponse(res, null, "Invalid audience", STATUS_CODES.UNAUTHORIZED);
//       return;
//     }

//     //4. Extract user data from Google
//     const { email, name = "Google User", picture } = payload;
//     if (!email) {
//       sendResponse(res, null, "Email not found in token", STATUS_CODES.BAD_REQUEST);
//       return;
//     }

//     //5. Find existing user or create new
//     let user = await User.findOne({ email });

//     if (!user) {
//       const hashedPassword = await bcrypt.hash("google-login", 10);

//       user = new User({
//         email,
//         password: hashedPassword,
//         name,
//         role: "user",
//         otp: { isVerified: true },
//         profilePicture: picture || "",
//       });

//       // Optional: Create Stripe customer
//       const stripeCustomer = await createCustomer(email, name);
//       if (stripeCustomer?.id) {
//         user.stripe.customerId = stripeCustomer.id;
//       }

//       await user.save();

//       // Optional: Send welcome email
//       await sendEmail({
//         to: email,
//         name,
//         subject: "Welcome to our App",
//         content: `Hi ${name}, your account has been created via Google login.`,
//       });
//     }

//     //6. Generate JWT for app session
//     const token = jwt.sign(
//       { uid: user._id, email: user.email },
//       process.env.JWT_SECRET as string,
//       { expiresIn: "12h" }
//     );

//     //7. Success response
//     sendResponse(
//       res,
//       {
//         token,
//         user: {
//           id: user._id,
//           name: user.name,
//           email: user.email,
//           avatar: user.profilePicture,
//           provider: "google",
//           platform: platform || "web",
//         },
//       },
//       "Google login successful",
//       STATUS_CODES.OK
//     );
//   } catch (error) {
//     console.error("Google login error:", error);
//     next(error);
//   }
// };
// }

// Controller: Apple Login
import jwksClient from "jwks-rsa";

dotenv.config();

//Apple JWKS client to get Apple public keys
const client = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
});

//Helper to get Apple public key by key ID
const getApplePublicKey = (kid: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      const signingKey = key?.getPublicKey();
      if (!signingKey) return reject("Unable to get Apple public key");
      resolve(signingKey);
    });
  });
};

//Apple client IDs (audiences)
// const ALLOWED_APPLE_AUDIENCES = new Set(
//   [process.env.APPLE_CLIENT_ID].filter((id): id is string => Boolean(id))
// );

const ALLOWED_APPLE_AUDIENCES = new Set(
  [
    process.env.APPLE_CLIENT_ID,   // e.g. com.dcodax.ajar.app
    process.env.APPLE_WEB_ID,      // optional, if you add one later
  ].filter(Boolean)
);


//Apple Login Controller
export const appleLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { idToken, platform } = req.body;

    if (!idToken) {
      sendResponse(res, null, "Missing Apple ID token", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Decode JWT header to extract `kid`
    const decodedHeader = jwt.decode(idToken, { complete: true }) as {
      header: { kid: string; alg: string };
    } | null;

    if (!decodedHeader?.header?.kid) {
      sendResponse(res, null, "Invalid Apple token header", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    // Fetch Apple public key & verify token
    const publicKey = await getApplePublicKey(decodedHeader.header.kid);
    const applePayload = jwt.verify(idToken, publicKey, {
      algorithms: ["RS256"],
    }) as {
      email?: string;
      email_verified?: string;
      sub: string;
      aud: string;
      iss: string;
    };

    // Validate issuer & audience
    if (applePayload.iss !== "https://appleid.apple.com") {
      sendResponse(res, null, "Invalid issuer", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    if (!ALLOWED_APPLE_AUDIENCES.has(applePayload.aud)) {
      sendResponse(res, null, "Invalid audience", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    const email = applePayload.email;
    const name = "Apple User";
    const picture = "";

    if (!email) {
      sendResponse(res, null, "Email not found in Apple token", STATUS_CODES.BAD_REQUEST);
      return;
    }

    //Find or create user
    let user = await User.findOne({ email });

    if (!user) {
      const hashedPassword = await bcrypt.hash("apple-login", 10);

      user = new User({
        name,
        email,
        password: hashedPassword,
        role: "user",
        otp: { isVerified: true },
        profilePicture: picture,
      });

      // Optional: Stripe customer creation
      const stripeCustomer = await createCustomer(email, name).catch(() => null);
      if (stripeCustomer?.id) {
        user.stripe = {
          customerId: stripeCustomer.id,
          subscriptionId: '',
          connectedAccountId: '',
          connectedAccountLink: ''
        };
      }

      await user.save();

      // Optional: Welcome email
      await sendEmail({
        to: email,
        name,
        subject: "Welcome to our App",
        content: `Hi ${name}, your account has been created via Apple login.`,
      });
    }

    // Generate token using the same utility as normal login
    const accessToken = generateAccessToken({
      id: user._id,
      email: user.email,
      role: user.role,
    });


    //Success response
    sendResponse(
      res,
      {
        token:accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.profilePicture,
          provider: "apple",
          platform: platform || "ios",
        },
      },
      "Apple login successful",
      STATUS_CODES.OK
    );
  } catch (error) {
    console.error("Apple login error:", error);
    next(error);
  }
};
