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

// export const loginUser = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   const { email, password, role } = req.body;

//   try {
//     if (role === "staff") {
//       const employee = await Employee.findOne({ email })
//         .populate({
//           path: "allowAccess",
//           select: "-__v",
//         })
//         .select("-__v")
//         .lean();

//       if (!employee) {
//         sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
//         return;
//       }

//       if (employee.password !== password) {
//         sendResponse(
//           res,
//           null,
//           "Invalid email or password",
//           STATUS_CODES.UNAUTHORIZED
//         );
//         return;
//       }

//       const accessToken = generateAccessToken({
//         id: employee._id,
//         role: "staff",
//       });

//       sendResponse(
//         res,
//         {
//           token: accessToken,
//           user: employee,
//         },
//         "Login successful (staff)",
//         STATUS_CODES.OK
//       );
//     } else if (role === "user" || role === "admin") {
//       const user = await User.findOne({ email, role })
//         .select("-password")
//         .lean();

//       if (!user) {
//         sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
//         return;
//       }

//       const isPasswordValid = await bcrypt.compare(
//         password,
//         (await User.findOne({ email, role }))?.password || ""
//       );
//       if (!isPasswordValid) {
//         sendResponse(
//           res,
//           null,
//           "Invalid email or password",
//           STATUS_CODES.UNAUTHORIZED
//         );
//         return;
//       }

//       const accessToken = generateAccessToken({
//         id: user._id,
//         role: user.role,
//       });



//       if (user.twoFactor?.enabled) {
//   // 1) Generate short-lived temp token
//   const tempToken = generateAccessToken(
//     { id: user._id, role: user.role, twoFAStage: true },
//     "5m" // 5-minute token
//   );

//   // 2) Generate 6-digit OTP
//   const loginCode = Math.floor(100000 + Math.random() * 900000).toString();

//   await User.findByIdAndUpdate(user._id, {
//     "twoFactor.loginCode": loginCode,
//     "twoFactor.loginExpiry": new Date(Date.now() + 5 * 60 * 1000),
//   });

//   // 3) Send OTP to email
//   await sendEmail({
//     to: user.email,
//     name: user.name,
//     subject: "Your 2FA Login Code",
//     content: `Your login 2FA code is: ${loginCode}. It expires in 5 minutes.`,
//   });

//    sendResponse(
//     res,
//     {
//       require2FA: true,
//       tempToken,
//       email: user.email,
//       message: "Enter the 6-digit 2FA code or backup code",
//     },
//     "2FA required",
//     206
//   ); return;
// }

//       sendResponse(
//         res,
//         {
//           token: accessToken,
//           user: user,
//         },
//         "Login successful",
//         STATUS_CODES.OK
//       );
//     } else {
//       sendResponse(
//         res,
//         null,
//         "Invalid role provided",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }
//   } catch (error) {
//     next(error);
//   }
// };





// ==================== LOGIN USER ====================
export const loginUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { email, password, role } = req.body;

  try {
    if (role === "staff") {
      // STAFF login unchanged
      const employee = await Employee.findOne({ email })
        .populate({ path: "allowAccess", select: "-__v" })
        .select("-__v")
        .lean();

      if (!employee) {
        sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
        return;
      }

      if (employee.password !== password) {
        sendResponse(res, null, "Invalid email or password", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      const accessToken = generateAccessToken({
        id: employee._id,
        role: "staff",
      });

      sendResponse(res, { token: accessToken, user: employee }, "Login successful (staff)", STATUS_CODES.OK);
      return;
    }

    // USER / ADMIN login
    const user = await User.findOne({ email, role });
    if (!user) {
      sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      sendResponse(res, null, "Invalid email or password", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    // --- ONLY FOR USERS WITH 2FA ENABLED ---
    if (user.twoFactor?.enabled) {
      // 1) Generate short-lived temp token for 2FA stage
      const tempToken = generateAccessToken(
        { id: user._id, role: user.role, twoFAStage: true },
        "5m" // 5-minute token
      );

      // 2) Generate 6-digit login OTP
      const loginCode = Math.floor(100000 + Math.random() * 900000).toString();

      await User.findByIdAndUpdate(user._id, {
        "twoFactor.loginCode": loginCode,
        "twoFactor.loginExpiry": new Date(Date.now() + 5 * 60 * 1000),
      });

      // 3) Send OTP to email
      await sendEmail({
        to: user.email,
        name: user.name,
        subject: "Your 2FA Login Code",
        content: `Your login 2FA code is: ${loginCode}. It expires in 5 minutes.`,
      });

      // 4) Respond requiring 2FA
      sendResponse(
        res,
        {
          require2FA: true,
          tempToken,
          email: user.email,
          message: "Enter the 6-digit 2FA code or backup code",
        },
        "2FA required",
        206
      );
      return;
    }

    // --- NORMAL LOGIN FLOW (2FA not enabled) ---
    const accessToken = generateAccessToken({
      id: user._id,
      role: user.role,
      twoFactorVerified: true, // no 2FA required, so verified by default
    });

    sendResponse(res, { token: accessToken, user }, "Login successful", STATUS_CODES.OK);

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

 // Save FCM token
export const saveFcmToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user?.id; // now TS knows id exists

    if (!userId) {
      return sendResponse(
        res,
        null,
        "Unauthorized: User not logged in",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    if (!fcmToken) {
      return sendResponse(
        res,
        null,
        "FCM token is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { fcmToken },
      { new: true }
    ).select("-password");

    if (!user) {
      return sendResponse(
        res,
        null,
        "User not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    sendResponse(
      res,
      { user },
      "FCM token saved successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
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

// Controller: Apple Login
import jwksClient from "jwks-rsa";
import { WalletTransaction } from "../models/walletTransaction.model";
import { WithdrawRequest } from "../models/withdrawRequest.model";
import mongoose from "mongoose";

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

//wallet controller 
// Get wallet balance & transactions
export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    // const user = await User.findById(userId).select("wallet balance");
    const user = await User.findById(userId).select("wallet");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Fetch transactions from WalletTransaction collection
    const transactions = await WalletTransaction.find({ userId }).sort({ createdAt: -1 });

    res.status(200).json({
      balance: user.wallet.balance,
      transactions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
};

// Add money to wallet
export const addToWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid amount" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Update balance
    user.wallet.balance += amount;
    await user.save();

    // Create transaction in separate collection
    const transaction = new WalletTransaction({
      userId,
      type: "credit",
      amount,
      source: "stripe",
      description,
      createdAt: new Date(),
    });
    await transaction.save();

    res.status(200).json({
      message: "Wallet credited",
      balance: user.wallet.balance,
      transaction,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
};

// Deduct money from wallet
export const deductFromWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid amount" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.wallet.balance < amount)
      return res.status(400).json({ message: "Insufficient wallet balance" });

    // Update balance
    user.wallet.balance -= amount;
    await user.save();

    // Create transaction in separate collection
    const transaction = new WalletTransaction({
      userId,
      type: "debit",
      amount,
      source: "booking",
      description,
      createdAt: new Date(),
    });
    await transaction.save();

    res.status(200).json({
      message: "Wallet debited",
      balance: user.wallet.balance,
      transaction,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
};

// Add bank account to user profile
export const addBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendResponse(res, null, "Unauthorized user", 401);
    }

    const { bankName, accountName, accountNumber, ibanNumber } = req.body;

    if (!bankName || !accountName || !accountNumber || !ibanNumber) {
      return sendResponse(res, null, "All fields are required", 400);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          bankAccounts: {
            bankName,
            accountName,
            accountNumber,
            ibanNumber,
          },
        },
      },
      { new: true }
    ).select("-password");

    return sendResponse(
      res,
      { user: updatedUser },
      "Bank account added successfully",
      201
    );
  } catch (error) {
    console.log(error);
    return sendResponse(res, null, "Server error", 500);
  }
};

export const getBankAccounts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId)
      .select("name email phone bankAccounts")
      .lean();

    if (!user) {
      return sendResponse(res, null, "User not found", 404);
    }

    return sendResponse(
      res,
     {
        userDetails: {
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
        bankAccounts: user.bankAccounts || [],
      },
      "Bank accounts fetched successfully",
      200
    );
  } catch (err) {
    console.error(err);
    sendResponse(res, null, "Server error", 500);
  }
};

// Update a specific bank account
export const updateBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { bankAccountId } = req.params;
    const { bankName, accountName, accountNumber, ibanNumber } = req.body;

    if (!userId) {
      return sendResponse(res, null, "Unauthorized user", STATUS_CODES.UNAUTHORIZED);
    }

    if (!bankName || !accountName || !accountNumber || !ibanNumber) {
      return sendResponse(res, null, "All fields are required", STATUS_CODES.BAD_REQUEST);
    }

    // Update the specific bank account inside the array
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, "bankAccounts._id": bankAccountId },
      {
        $set: {
          "bankAccounts.$.bankName": bankName,
          "bankAccounts.$.accountName": accountName,
          "bankAccounts.$.accountNumber": accountNumber,
          "bankAccounts.$.ibanNumber": ibanNumber,
        },
      },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return sendResponse(res, null, "Bank account not found", STATUS_CODES.NOT_FOUND);
    }

    return sendResponse(res, { user: updatedUser }, "Bank account updated successfully", STATUS_CODES.OK);
  } catch (error) {
    console.error(error);
    return sendResponse(res, null, "Server error", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Delete a specific bank account
export const deleteBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { bankAccountId } = req.params;

    if (!userId) {
      return sendResponse(res, null, "Unauthorized user", STATUS_CODES.UNAUTHORIZED);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $pull: { bankAccounts: { _id: bankAccountId } } },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return sendResponse(res, null, "Bank account not found", STATUS_CODES.NOT_FOUND);
    }

    return sendResponse(res, { user: updatedUser }, "Bank account deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    console.error(error);
    return sendResponse(res, null, "Server error", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const instantWithdrawal = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { amount, bankAccountId } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return sendResponse(res, null, "Invalid withdrawal amount", 400);
    }

    if (!bankAccountId) {
      return sendResponse(res, null, "Bank account is required", 400);
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) return sendResponse(res, null, "User not found", 404);

    // Check wallet balance
    if (user.wallet.balance < amount) {
      return sendResponse(res, null, "Insufficient wallet balance", 400);
    }

    // Deduct from wallet
    user.wallet.balance -= amount;
    await user.save();

    // Create wallet transaction
    const transaction = new WalletTransaction({
      userId,
      type: "debit",
      amount,
      source: "withdraw",
      bankAccountId,
      description: "Withdrawal processed instantly",
      createdAt: new Date(),
    });

    await transaction.save();

    // Response
    return sendResponse(
      res,
      {
        message: "Withdrawal successful",
        balance: user.wallet.balance,
        transaction,
      },
      "Withdrawal processed",
      200
    );
  } catch (err) {
    console.error(err);
    return sendResponse(res, null, "Server error", 500);
  }
};

// Get user's withdrawals
export const getUserWithdrawals = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    // Fetch only withdrawal transactions
    const withdrawals = await WalletTransaction.find({
      userId,
      type: "debit",
      source: "withdraw"
    }).sort({ createdAt: -1 }); // latest first

    return sendResponse(
      res,
      { withdrawals },
      "Your withdrawal history fetched",
      200
    );
  } catch (err) {
    console.error(err);
    return sendResponse(res, null, "Server error", 500);
  }
};

// Get withdrawal history by range or custom date
// export const getWithdrawalHistoryByRange = async (req: any, res: Response) => {
//   try {
//     const userId = req.user.id;
//     const { range, days, startDate: startStr, endDate: endStr } = req.query;

//     const now = new Date();
//     let startDate: Date | undefined;
//     let endDate: Date | undefined = now;

//     // Custom startDate / endDate if provided
//     if (startStr) startDate = new Date(startStr);
//     if (endStr) endDate = new Date(endStr);

//     if (!startDate) {
//       switch (range) {
//         case "weekly":
//           startDate = new Date(now);
//           startDate.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
//           startDate.setHours(0, 0, 0, 0);
//           break;
//         case "monthly":
//           startDate = new Date(now.getFullYear(), now.getMonth(), 1); // Start of month
//           break;
//         default:
//           if (days) {
//             const dayCount = parseInt(days as string, 10);
//             if (isNaN(dayCount) || dayCount <= 0) {
//               return sendResponse(res, null, "Invalid 'days' query", 400);
//             }
//             startDate = new Date(now);
//             startDate.setDate(now.getDate() - dayCount);
//           } else {
//             return sendResponse(
//               res,
//               null,
//               "Invalid range. Use 'weekly', 'monthly', or provide 'days'",
//               400
//             );
//           }
//       }
//     }

//     const withdrawals = await WalletTransaction.find({
//       userId,
//       type: "debit",
//       source: "withdraw",
//       createdAt: { $gte: startDate, $lte: endDate },
//     }).sort({ createdAt: -1 });

//     return sendResponse(
//       res,
//       { withdrawals },
//       `Withdrawal history from ${startDate.toDateString()} to ${endDate.toDateString()}`,
//       200
//     );
//   } catch (err) {
//     console.error(err);
//     return sendResponse(res, null, "Server error", 500);
//   }
// };



// NEW: Monthly wallet graph (withdrawals + topups)
export const getWithdrawalHistoryByRange = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { range, days, startDate: startStr, endDate: endStr } = req.query;

    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date | undefined = now;

    // 1️⃣ Custom startDate / endDate
    if (startStr) startDate = new Date(startStr);
    if (endStr) endDate = new Date(endStr);

    // 2️⃣ Weekly, monthly, or last N days
    if (!startDate) {
      switch (range) {
        case "weekly":
          startDate = new Date(now);
          startDate.setDate(now.getDate() - now.getDay()); // Sunday
          startDate.setHours(0, 0, 0, 0);
          break;
        case "monthly":
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          if (days) {
            const dayCount = parseInt(days as string, 10);
            if (isNaN(dayCount) || dayCount <= 0)
              return sendResponse(res, null, "Invalid 'days' query", 400);
            startDate = new Date(now);
            startDate.setDate(now.getDate() - dayCount);
          } else {
            // Default last 6 months
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
          }
      }
    }

    // 3️⃣ Fetch raw withdrawal transactions
    const withdrawals = await WalletTransaction.find({
      userId,
      type: "debit",
      source: "withdraw",
      createdAt: { $gte: startDate, $lte: endDate },
    }).sort({ createdAt: -1 });

    // 4️⃣ Aggregate graph data (withdrawals + top-ups)
    const graphData = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            week: { $week: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          totalWithdraw: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$type", "debit"] }, { $eq: ["$source", "withdraw"] }] },
                "$amount",
                0,
              ],
            },
          },
          totalTopup: {
            $sum: {
              $cond: [{ $eq: ["$type", "credit"] }, "$amount", 0],
            },
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1, "_id.day": 1 } },
    ]);

    // 5️⃣ Format graph for frontend
    const finalGraph = graphData.map((item: any) => {
      let label = "";

      if (range === "weekly") {
        label = `Week ${item._id.week}, ${item._id.year}`;
      } else if (range === "monthly") {
        label = new Date(item._id.year, item._id.month - 1).toLocaleString("en-US", {
          month: "long",
        });
      } else if (days || startStr || endStr) {
        label = `${item._id.day}-${item._id.month}-${item._id.year}`;
      } else {
        label = new Date(item._id.year, item._id.month - 1).toLocaleString("en-US", {
          month: "long",
        });
      }

      return {
        label,
        withdraw: item.totalWithdraw,
        topup: item.totalTopup,
      };
    });

    // 6️⃣ Return raw withdrawals + graph
    return sendResponse(
      res,
      { withdrawals, graph: finalGraph },
      `Withdrawal history from ${startDate.toDateString()} to ${endDate.toDateString()}`,
      200
    );
  } catch (err) {
    console.error(err);
    return sendResponse(res, null, "Server error", 500);
  }
};







// Get all withdrawals (admin)
export const getAllWithdrawals = async (req: any, res: Response) => {
  try {
    const withdrawals = await WithdrawRequest.find().populate("userId", "name email");
    return sendResponse(res, { withdrawals }, "All withdrawal requests fetched", 200);
  } catch (err) {
    console.error(err);
    return sendResponse(res, null, "Server error", 500);
  }
};

// Admin approves/rejects withdrawal
export const processWithdrawal = async (req: any, res: Response) => {
  try {
    const { requestId } = req.params;
    const { action, reason } = req.body; // action = 'approve' | 'reject'

    const withdrawRequest = await WithdrawRequest.findById(requestId);
    if (!withdrawRequest) return sendResponse(res, null, "Request not found", 404);
    if (withdrawRequest.status !== "pending")
      return sendResponse(res, null, "Request already processed", 400);

    const user = await User.findById(withdrawRequest.userId);
    if (!user) return sendResponse(res, null, "User not found", 404);

    if (action === "approve") {
      if (user.wallet.balance < withdrawRequest.amount) {
        return sendResponse(res, null, "Insufficient wallet balance", 400);
      }

      // Deduct from wallet
      user.wallet.balance -= withdrawRequest.amount;
      await user.save();

      //FIX ADDED: bankAccountId is now passed in transaction
      const transaction = new WalletTransaction({
        userId: user._id,
        type: "debit",
        amount: withdrawRequest.amount,
        bankAccountId: withdrawRequest.bankAccountId, //REQUIRED FIELD ADDED
        source: "withdraw",
        description: `Withdrawal approved`,
      });
      await transaction.save();

      withdrawRequest.status = "approved";
      withdrawRequest.processedAt = new Date();
      await withdrawRequest.save();

      return sendResponse(
        res,
        { withdrawRequest, transaction },
        "Withdrawal approved",
        200
      );

    } else if (action === "reject") {
      withdrawRequest.status = "rejected";
      withdrawRequest.reason = reason || "Rejected by admin";
      withdrawRequest.processedAt = new Date();
      await withdrawRequest.save();

      return sendResponse(res, { withdrawRequest }, "Withdrawal rejected", 200);
    } else {
      return sendResponse(res, null, "Invalid action", 400);
    }
  } catch (err) {
    console.error(err);
    return sendResponse(res, null, "Server error", 500);
  }
};
