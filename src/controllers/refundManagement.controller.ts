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
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (!(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: "Invalid subCategory ID" });
      return;
    }

    const refundSettings = await RefundManagement.create(sanitizedBody);

    const { status, ...dataWithoutStatus } = refundSettings.toObject();

    res.status(201).json({
      success: true,
      message: "Refund settings created successfully",
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
      res.status(404).json({ message: "Refund settings not found" });
      return;
    }

    if (zone && !(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (
      subCategory &&
      !(await isValidObjectIdAndExists(subCategory, Category))
    ) {
      res.status(400).json({ message: "Invalid subCategory ID" });
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
      message: "Refund settings updated successfully",
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
      res.status(404).json({ message: "Refund settings not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Refund settings deleted successfully",
    });
  }
);

// Create Refund Request (User)
export const createRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response): Promise<void> => {
    const { user } = req as any;

    // Allow only safe fields
    const allowedUserFields = ["booking", "reason", "selectTime"];
    const sanitizedBody: any = {};

    allowedUserFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        sanitizedBody[field] = req.body[field];
      }
    });

    const { booking, reason, selectTime, note } = sanitizedBody;

    // Validate booking
    if (!(await isValidObjectIdAndExists(booking, Booking))) {
      res.status(400).json({ message: "Invalid booking ID" });
      return;
    }

    // Check if refund request already exists for this booking and user
    const existingRefund = await RefundRequest.findOne({
      booking,
      user: req.user?.id,
    });


    if (existingRefund) {
      sendResponse(
        res,
        null,
        "Refund request For this booking already exists",
        STATUS_CODES.NOT_FOUND
      );
    }

    // Get booking + listing
    const bookingData = await Booking.findById(booking).populate(
      "marketplaceListingId"
    );

    if (!bookingData || !bookingData.marketplaceListingId) {
      res.status(404).json({ message: "Booking or listing not found" });
      return;
    }

    const listing: any = bookingData.marketplaceListingId;
    const zone = listing.zone;
    const subCategory = listing.subCategory;

    // Find refund policy
    const policy = await RefundPolicy.findOne({ zone, subCategory });

    if (!policy || !policy.allowFund) {
      res.status(400).json({ message: "Refund not allowed for this booking" });
      return;
    }

    // Calculate time difference
    const checkInDate = new Date(bookingData.dates.checkIn);
    const now = new Date();

    const hoursUntilCheckIn =
      (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Use cancellationCutoffTime
    const cutoffHours =
      (policy.cancellationCutoffTime?.days || 0) * 24 +
      (policy.cancellationCutoffTime?.hours || 0);
    console.log("hoursUntilCheckIn", hoursUntilCheckIn)
    console.log("cutoffHours", cutoffHours)

    // Flat fee amount
    const flatFee = Number((policy as any).flatFee?.amount ?? 0);

    const totalPrice = bookingData.priceDetails.totalPrice || 0;

    let deduction = 0;
    let totalRefundAmount = 0;

    if (hoursUntilCheckIn > cutoffHours) {
      deduction = flatFee;
      totalRefundAmount = totalPrice - deduction;
    } else {
      deduction = totalPrice;
      totalRefundAmount = 0;
    }

    // ✅ Create refund request (schema-safe)
    const refundRequest = await RefundRequest.create({
      booking,
      reason,
      selectTime,
      user: user?.id,
      deduction,
      totalRefundAmount,
      policy: policy._id,
      note,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Refund request submitted successfully",
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
//       res.status(400).json({ message: "Invalid booking ID" });
//       return;
//     }

//     // booking + listing lao
//     const bookingData = await Booking.findById(booking).populate(
//       "marketplaceListingId"
//     );

//     if (!bookingData || !bookingData.marketplaceListingId) {
//       res.status(404).json({ message: "Booking or listing not found" });
//       return;
//     }

//     const listing: any = bookingData.marketplaceListingId;
//     const zone = listing.zone;
//     const subCategory = listing.subCategory;

//     // Refund policy lao (naya model)
//     const policy = await RefundPolicy.findOne({ zone, subCategory });

//     if (!policy || !policy.allowFund) {
//       res.status(400).json({
//         message: "Refund not allowed for this booking",
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
//       message: "Refund request submitted successfully",
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
      res.status(404).json({ message: "Refund request not found" });
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
      res.status(400).json({ message: "Invalid booking ID" });
      return;
    }

    Object.assign(refund, updates);
    await refund.save();

    res.status(200).json({
      success: true,
      message: "Refund request updated",
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
      res.status(404).json({ message: "Refund request not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Refund request deleted",
    });
  }
);

// Get Refund Request by ID (User/Admin)
export const getRefundRequestById = asyncHandler(
  async (req: Request & { user?: any }, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid refund ID" });
      return;
    }

    const refund = await RefundManagement.findById(id)
      .populate("zone", "zoneName")
      .populate("subCategory", "categoryName")
      .populate("booking");

    if (!refund) {
      res.status(404).json({ message: "Refund request not found" });
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
      .populate("booking");

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
      res.status(400).json({ message: "Invalid status value" });
      return;
    }

    const refund = await RefundManagement.findById(id);
    if (!refund) {
      res.status(404).json({ message: "Refund request not found" });
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
