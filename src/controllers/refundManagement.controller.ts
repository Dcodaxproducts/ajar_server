import { Request, Response, NextFunction } from "express";
import { RefundManagement } from "../models/refundManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import { Booking } from "../models/booking.model";
import { paginateQuery } from "../utils/paginate";

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
  async (req: Request  & { user?: any }, res: Response) => {
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

//for leaser
// Create Refund Request (User)
export const createRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response): Promise<void> => {
    // FIX: Cast req to AuthRequest to safely access req.user
    const { user } = req as any;

    const allowedUserFields = ["booking", "reason", "selectTime"];

    const sanitizedBody: any = {};
    allowedUserFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        sanitizedBody[field] = req.body[field];
      }
    });

    const { booking } = sanitizedBody;

    if (!(await isValidObjectIdAndExists(booking, Booking))) {
      res.status(400).json({ message: "Invalid booking ID" });
      return;
    }

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

    const policy = await RefundManagement.findOne({ zone, subCategory });

    if (!policy || !policy.allowFund) {
      res.status(400).json({ message: "Refund not allowed for this booking" });
      return;
    }

    const checkInDate = new Date(bookingData.dates.checkIn);
    const now = new Date();
    const msUntilCheckIn = checkInDate.getTime() - now.getTime();
    const hoursUntilCheckIn = msUntilCheckIn / (1000 * 60 * 60);

    const cutoffHours =
      (policy.cutoffTime.days || 0) * 24 + (policy.cutoffTime.hours || 0);
    const flatFee = policy.flatFee || 0;
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

    const refund = await RefundManagement.create({
      ...sanitizedBody,
      deduction,
      totalRefundAmount,
      zone,
      subCategory,
      allowFund: policy.allowFund,
      cutoffTime: policy.cutoffTime,
      flatFee: policy.flatFee,
      time: policy.time,
      note: policy.note,
      user: user?.id, 
    });

    res.status(201).json({
      success: true,
      message: "Refund request submitted successfully",
      data: refund,
    });
  }
);

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
