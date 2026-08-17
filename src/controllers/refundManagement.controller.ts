import { Request, Response, NextFunction } from "express";
import { RefundManagement } from "../models/refundManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import { Booking } from "../models/booking.model";
import { paginateQuery } from "../utils/paginate";
import { RefundPolicy } from "../models/refundPolicy.model";
import { RefundRequest } from "../models/refundRequest.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { buildBookingRefund } from "../utils/buildBookingRefund";
import { notificationQueue } from "../queues/notification.queue";
import { User } from "../models/user.model";
import { capitalizeName } from "../utils/capitalizeName";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// Helper function to check if ObjectId is valid and exists
const isValidObjectIdAndExists = async (
  id: string,
  model: mongoose.Model<any>
): Promise<boolean> => {
  return mongoose.Types.ObjectId.isValid(id) && !!(await model.findById(id));
};

//Create Refund Settings (Admin)
export const createRefundSettings = asyncHandler(
  async (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    const allowedAdminFields = [
      "zone",
      "subCategory",
      "allowFund",
      "cutoffTime",
      "flatFee",
      "time",
      "note",
      "refundWindow",
    ];

    // Remove disallowed fields
    const sanitizedBody: any = {};
    allowedAdminFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        sanitizedBody[field] = req.body[field];
      }
    });

    const { zone, subCategory } = sanitizedBody;

    if (!(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: req.t("refund:settings.invalidZoneId") });
      return;
    }

    if (!(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: req.t("refund:settings.invalidSubCategoryId") });
      return;
    }

    const refundSettings = await RefundManagement.create(sanitizedBody);

    const { status, ...dataWithoutStatus } = refundSettings.toObject();

    res.status(201).json({
      success: true,
      message: req.t("refund:settings.created"),
      data: dataWithoutStatus,
    });
  }
);

//Get All Refund Settings (Admin)
export const getAllRefundSettings = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const baseQuery = RefundManagement.find()
      .populate("zone", "zoneName")
      .populate("subCategory", "categoryName");

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    // Remove 'status' field from each document
    const sanitizedData = data.map((item: any) => {
      const { status, ...rest } = item.toObject();
      return rest;
    });

    res.status(200).json({
      success: true,
      data: sanitizedData,
      total,
      page,
      limit,
    });
  }
);

//Update Refund Settings (Admin)
export const updateRefundSettings = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { id } = req.params;
    const {
      zone,
      subCategory,
      allowFund,
      cutoffTime,
      flatFee,
      time,
      note,
      refundWindow,
    } = req.body;

    const refund = await RefundManagement.findById(id);
    if (!refund) {
      res.status(404).json({ message: req.t("refund:settings.notFound") });
      return;
    }

    if (zone && !(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: req.t("refund:settings.invalidZoneId") });
      return;
    }

    if (
      subCategory &&
      !(await isValidObjectIdAndExists(subCategory, Category))
    ) {
      res.status(400).json({ message: req.t("refund:settings.invalidSubCategoryId") });
      return;
    }

    refund.zone = zone || refund.zone;
    refund.subCategory = subCategory || refund.subCategory;
    refund.allowFund = allowFund ?? refund.allowFund;
    refund.cutoffTime = cutoffTime || refund.cutoffTime;
    refund.flatFee = flatFee ?? refund.flatFee;
    refund.time = time || refund.time;
    refund.note = note || refund.note;
    refund.refundWindow = refundWindow || refund.refundWindow;

    await refund.save();

    res.status(200).json({
      success: true,
      message: req.t("refund:settings.updated"),
      data: refund,
    });
  }
);

//Delete Refund Settings (Admin)
export const deleteRefundSettings = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { id } = req.params;

    const refund = await RefundManagement.findByIdAndDelete(id);
    if (!refund) {
      res.status(404).json({ message: req.t("refund:settings.notFound") });
      return;
    }

    res.status(200).json({
      success: true,
      message: req.t("refund:settings.deleted"),
    });
  }
);

// Create Refund Request (User)
export const createRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response): Promise<void> => {
    const { user } = req as any;

    // only pick allowed fields from body
    const allowedUserFields = ["booking", "reason", "note"];
    const sanitizedBody: any = {};
    allowedUserFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        sanitizedBody[field] = req.body[field];
      }
    });

    const { booking, reason, note } = sanitizedBody;

    // validate booking ID
    if (!(await isValidObjectIdAndExists(booking, Booking))) {
      res.status(400).json({ message: req.t("booking:invalidId") });
      return;
    }

    // prevent duplicate refund requests
    const existingRefund = await RefundRequest.findOne({
      booking,
      user: user?.id,
    });

    if (existingRefund) {
      sendResponse(
        res,
        null,
        req.t("refund:alreadyExists"),
        STATUS_CODES.NOT_FOUND
      );
      return;
    }

    // fetch booking + listing
    const bookingData = await Booking.findById(booking).populate(
      "marketplaceListingId"
    );

    if (!bookingData || !bookingData.marketplaceListingId) {
      res.status(404).json({ message: req.t("refund:bookingOrListingNotFound") });
      return;
    }

    // only cancelled bookings are eligible
    if (bookingData.status !== "booking_cancelled") {
      res.status(400).json({
        success: false,
        message: req.t("refund:onlyCancelledStatus"),
      });
      return;
    }

    const listing: any = bookingData.marketplaceListingId;
    const renter: any = bookingData.renter;
    const listingName = listing?.name || "listing";

    // fetch refund policy
    const policy = await RefundPolicy.findOne({
      zone: listing.zone,
      subCategory: listing.subCategory,
    });

    if (!policy || !policy.allowRefund) {
      res.status(400).json({ message: req.t("refund:notAllowed") });
      return;
    }

    const securityDeposit = parseFloat(Number(bookingData.priceDetails?.securityDeposit ?? 0).toFixed(2));

    // Covers the parent booking, and on an early return its extensions too
    const result = await buildBookingRefund(bookingData, policy);

    // create refund request
    const refundRequest = await RefundRequest.create({
      booking,
      reason,
      note,
      user: user?.id,
      deduction: result.totalDeducted,
      totalRefundAmount: result.totalRefund,
      securityDeposit,
      policy: policy._id,
      status: "pending",
      isEarlyReturn: result.isEarlyReturn,
      breakdown: result.lines,
    });

    // link refund request back to booking
    await Booking.findByIdAndUpdate(booking, {
      refundRequest: refundRequest._id,
    });

    // ================= NOTIFICATIONS =================

    // Refund request is already saved — a queue failure must not fail the request
    try {
      // Renter — confirmation their request was received
      await notificationQueue.add("refund-request-submitted", {
        userId: renter._id.toString(),
        title: "Refund Request Submitted",
        message: `Your refund request for "${capitalizeName(listingName)}" has been submitted and is under review.`,
        data: {
          refundId: (refundRequest._id as any).toString(),
          bookingId: booking.toString(),
          type: "refund",
          status: "pending",
        },
      });

      // Admin — alert that a new refund request needs review
      const admin = await User.findOne({ role: "admin" });
      if (admin) {
        await notificationQueue.add("new-refund-request", {
          userId: (admin._id as any).toString(),
          title: "New Refund Request",
          message: `A new refund request has been submitted for "${capitalizeName(listingName)}" and requires your review.`,
          data: {
            refundId: (refundRequest._id as any).toString(),
            bookingId: booking.toString(),
            type: "refund",
            status: "pending",
          },
        });
      }
    } catch (err) {
      console.error("Failed to queue refund request notifications:", err);
    }

    res.status(201).json({
      success: true,
      message: req.t("refund:requestSubmitted"),
      data: refundRequest,
    });
  }
);

// export const createRefundRequest = asyncHandler(
//   async (req: Request & { user?: any }, res: Response): Promise<void> => {
//     const { user } = req as any;

//     // sirf allowed fields pick karo
//     const allowedUserFields = ["booking", "reason", "selectTime"];
//     const sanitizedBody: any = {};

//     allowedUserFields.forEach((field) => {
//       if (req.body[field] !== undefined) {
//         sanitizedBody[field] = req.body[field];
//       }
//     });

//     const { booking } = sanitizedBody;

//     // booking id validate
//     if (!(await isValidObjectIdAndExists(booking, Booking))) {
//       res.status(400).json({ message: req.t("booking:invalidId") });
//       return;
//     }

//     // booking + listing lao
//     const bookingData = await Booking.findById(booking).populate(
//       "marketplaceListingId"
//     );

//     if (!bookingData || !bookingData.marketplaceListingId) {
//       res.status(404).json({ message: req.t("refund:bookingOrListingNotFound") });
//       return;
//     }

//     const listing: any = bookingData.marketplaceListingId;
//     const zone = listing.zone;
//     const subCategory = listing.subCategory;

//     // Refund policy lao (naya model)
//     const policy = await RefundPolicy.findOne({ zone, subCategory });

//     if (!policy || !policy.allowFund) {
//       res.status(400).json({
//         message: req.t("refund:notAllowed"),
//       });
//       return;
//     }

//     // check-in tak kitne hours baqi hain
//     const checkInDate = new Date(bookingData.dates.checkIn);
//     const now = new Date();
//     const msUntilCheckIn = checkInDate.getTime() - now.getTime();
//     const hoursUntilCheckIn = msUntilCheckIn / (1000 * 60 * 60);

//     // cutoff time (days + hours => total hours)
//     const cutoffDays =
//       (policy as any).cancellationCutoffTime?.days ?? 0;
//     const cutoffHoursOnly =
//       (policy as any).cancellationCutoffTime?.hours ?? 0;

//     const cutoffHours = cutoffDays * 24 + cutoffHoursOnly;

//     // flat fee sirf number me nikalo (object nahi)
//     const flatFee = Number((policy as any).flatFee?.amount ?? 0);

//     const totalPrice = Number(
//       bookingData.priceDetails?.totalPrice ?? 0
//     );

//     let deduction: number = 0;
//     let totalRefundAmount: number = 0;

//     // ORIGINAL LOGIC (unchanged)
//     if (hoursUntilCheckIn > cutoffHours) {
//       deduction = flatFee;
//       totalRefundAmount = totalPrice - deduction;
//     } else {
//       deduction = totalPrice;
//       totalRefundAmount = 0;
//     }

//     // refund request create karo
//     const refund = await RefundManagement.create({
//       ...sanitizedBody,
//       deduction,
//       totalRefundAmount,
//       zone,
//       subCategory,

//       // policy snapshot fields
//       allowFund: policy.allowFund,
//       cancellationCutoffTime: (policy as any).cancellationCutoffTime,

//       // IMPORTANT: yahan sirf number save ho raha hai
//       flatFee: flatFee,

//       noteText: (policy as any).noteText,
//       refundWindow: (policy as any).refundWindow,

//       user: user?.id,
//     });

//     res.status(201).json({
//       success: true,
//       message: req.t("refund:requestSubmitted"),
//       data: refund,
//     });
//   }
// );

// Update Refund Request (User)
export const updateRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    // FIX: Cast req to AuthRequest
    const { user } = req as any;
    const { id } = req.params;

    const refund = await RefundManagement.findById(id);
    if (!refund) {
      res.status(404).json({ message: req.t("refund:requestNotFound") });
      return;
    }

    // Only allow updating user-permitted fields
    const allowedUserFields = ["booking", "reason", "selectTime", "note"];
    const updates: any = {};
    allowedUserFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Optional: validate booking if updated
    if (
      updates.booking &&
      !(await isValidObjectIdAndExists(updates.booking, Booking))
    ) {
      res.status(400).json({ message: req.t("booking:invalidId") });
      return;
    }

    Object.assign(refund, updates);
    await refund.save();

    res.status(200).json({
      success: true,
      message: req.t("refund:requestUpdated"),
      data: refund,
    });
  }
);

//Delete Refund Request (User)
export const deleteRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { id } = req.params;

    const refund = await RefundManagement.findByIdAndDelete(id);
    if (!refund) {
      res.status(404).json({ message: req.t("refund:requestNotFound") });
      return;
    }

    res.status(200).json({
      success: true,
      message: req.t("refund:requestDeleted"),
    });
  }
);

// Get Refund Request by ID (User/Admin)
export const getRefundRequestById = asyncHandler(
  async (req: Request & { user?: any }, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: req.t("refund:invalidRefundId") });
      return;
    }

    const refund = await RefundManagement.findById(id)
      .populate("zone", "zoneName")
      .populate("subCategory", "categoryName")
      .populate("booking");

    if (!refund) {
      res.status(404).json({ message: req.t("refund:requestNotFound") });
      return;
    }

    res.status(200).json({
      success: true,
      data: refund,
    });
  }
);

// Get All Refund Requests (User Only)
export const getMyRefundRequests = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    //FIX: Cast req to AuthRequest
    const { user } = req as any;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const isAdmin = user?.role === "admin";
    const filter: any = isAdmin ? {} : { user: user?.id };

    const baseQuery = RefundManagement.find(filter)
      .populate("zone", "zoneName")
      .populate("subCategory", "categoryName")
      .populate("booking")
      // Newest first, and without it paginated pages can repeat or skip rows
      .sort({ createdAt: -1 });

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    const [pendingRequests, rejectedRequests, acceptedRequests] =
      await Promise.all([
        RefundManagement.countDocuments({ ...filter, status: "pending" }),
        RefundManagement.countDocuments({ ...filter, status: "reject" }),
        RefundManagement.countDocuments({ ...filter, status: "accept" }),
      ]);

    res.status(200).json({
      success: true,
      data,
      totalRequests: total,
      pendingRequests,
      rejectedRequests,
      acceptedRequests,
      page,
      limit,
    });
  }
);

// Update Refund Request Status (Admin Only)
export const updateRefundStatus = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!["pending", "accept", "reject"].includes(status)) {
      res.status(400).json({ message: req.t("refund:invalidStatus") });
      return;
    }

    const refund = await RefundManagement.findById(id);
    if (!refund) {
      res.status(404).json({ message: req.t("refund:requestNotFound") });
      return;
    }

    refund.status = status;
    await refund.save();

    res.status(200).json({
      success: true,
      message: `Refund request status updated to '${status}'`,
      data: refund,
    });
  }
);

export const getRefundPreview = asyncHandler(
  async (req: Request & { user?: any }, res: Response): Promise<void> => {
    const bookingId = req.query.bookingId as string;

    // validate booking ID
    if (!bookingId || !(await isValidObjectIdAndExists(bookingId, Booking))) {
      res.status(400).json({ success: false, message: req.t("refund:invalidBookingId") });
      return;
    }

    const booking = await Booking.findById(bookingId).populate("marketplaceListingId");

    if (!booking || !booking.marketplaceListingId) {
      res.status(404).json({ success: false, message: req.t("booking:notFound") });
      return;
    }

    // booking must be in a cancellable state
    if (booking.status !== "booking_cancelled") {
      res.status(400).json({ success: false, message: req.t("refund:onlyCancelledBookings") });
      return;
    }

    const listing = booking.marketplaceListingId as any;

    const policy = await RefundPolicy.findOne({
      zone: listing.zone,
      subCategory: listing.subCategory,
    });

    if (!policy || !policy.allowRefund) {
      res.status(200).json({
        success: true,
        data: {
          totalBookingAmount: booking.priceDetails.totalPrice,
          deductionFee: booking.priceDetails.totalPrice,
          estimatedRefund: 0,
          isEligible: false,
          appliedTier: null,
          reason: "Refunds are not allowed for this category/zone",
        },
      });
      return;
    }

    // Covers the parent booking, and on an early return its extensions too
    const result = await buildBookingRefund(booking, policy);

    const adminFee = booking.priceDetails.adminFee ?? 0;
    const tax = booking.priceDetails.tax ?? 0;
    const securityDeposit = booking.priceDetails.securityDeposit ?? 0;

    // The platform keeps its fee once the rental has actually run, and the
    // deposit settles later through the dispute window instead
    const estimatedRefund = result.isEarlyReturn
      ? result.totalRefund
      : parseFloat((result.totalRefund + adminFee + tax).toFixed(2));

    const totalToWallet = result.isEarlyReturn
      ? estimatedRefund
      : parseFloat((estimatedRefund + securityDeposit).toFixed(2));

    res.status(200).json({
      success: true,
      data: {
        totalBookingAmount: result.totalPrice,
        deductionFee: result.totalDeducted,
        securityDeposit,
        estimatedRefund,
        totalToWallet,
        isEligible: totalToWallet > 0,
        appliedTier: result.appliedTier,
        reason: result.reason,
        basis: result.basis,
        isEarlyReturn: result.isEarlyReturn,
        breakdown: result.lines,
      },
    });
  }
);
