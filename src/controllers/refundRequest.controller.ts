import { Request, Response } from "express";
import { RefundRequest } from "../models/refundRequest.model";
import { RefundPolicy } from "../models/refundPolicy.model";
import { Booking } from "../models/booking.model";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { paginateQuery } from "../utils/paginate";
import { AuthRequest } from "../middlewares/auth.middleware";
import { RefundManagement } from "../models/refundManagement.model";

// Create Refund Request
export const createRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { booking, reason, selectTime } = req.body;

    if (!mongoose.Types.ObjectId.isValid(booking)) {
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

    const policy = await RefundPolicy.findOne({ zone, subCategory });
    if (!policy || !policy.allowFund) {
      res.status(400).json({ message: "Refund not allowed for this booking" });
      return;
    }

    const checkInDate = new Date(bookingData.dates.checkIn);
    const now = new Date();
    const hoursUntilCheckIn =
      (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    const cutoffHours =
      (policy.cancellationCutoffTime?.days || 0) * 24 +
      (policy.cancellationCutoffTime?.hours || 0);

    // Convert flatFee.amount to number safely
    const flatFeeAmount = Number(policy.flatFee?.amount) || 0;
    const totalPrice = bookingData.priceDetails?.totalPrice || 0;

    let deduction = 0;
    let totalRefundAmount = 0;

    if (hoursUntilCheckIn > cutoffHours) {
      deduction = flatFeeAmount;
      totalRefundAmount = totalPrice - deduction;
    } else {
      deduction = totalPrice;
      totalRefundAmount = 0;
    }

    const refund = await RefundRequest.create({
      booking,
      reason,
      selectTime,
      deduction,
      totalRefundAmount,
      policy: policy._id,
      user: req.user?.id,
    });

    res.status(201).json({
      success: true,
      message: "Refund request submitted successfully",
      data: refund,
    });
  }
);

// Get My Refund Requests
// export const getMyRefundRequests = asyncHandler(
//   async (req: Request & { user?: any }, res: Response) => {
//     const page = Number(req.query.page) || 1;
//     const limit = Number(req.query.limit) || 10;

//     const filter: any = {  };

//     const baseQuery = RefundManagement.find(filter)
//       // .populate("policy")
//       .populate("booking");

//     // Paginated results
//     const { data, total } = await paginateQuery(baseQuery, { page, limit });

//     // Status breakdown + total requests
//     const [pending, rejected, accepted, totalRequests] = await Promise.all([
//       RefundRequest.countDocuments({ ...filter, status: "pending" }),
//       RefundRequest.countDocuments({ ...filter, status: "reject" }),
//       RefundRequest.countDocuments({ ...filter, status: "accept" }),
//       RefundRequest.countDocuments(filter),
//     ]);

//     res.status(200).json({
//       success: true,
//       data,
//       totalRequests,
//       pending,
//       rejected,
//       accepted,
//       total,
//       page,
//       limit,
//     });
//   }
// );
export const getMyRefundRequests = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const filter: any = { user: req.user?.id };

    const baseQuery = RefundRequest.find(filter)
      .populate("policy")
      .populate("booking");

    // Paginated results
    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    // Status breakdown + total requests
    const [pending, rejected, accepted, totalRequests] = await Promise.all([
      RefundRequest.countDocuments({ ...filter, status: "pending" }),
      RefundRequest.countDocuments({ ...filter, status: "reject" }),
      RefundRequest.countDocuments({ ...filter, status: "accept" }),
      RefundRequest.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data,
      totalRequests,
      pending,
      rejected,
      accepted,
      total,
      page,
      limit,
    });
  }
);

// Get Refund Request by ID

export const getRefundRequestById = asyncHandler(
  async (req: Request & { user?: any }, res: Response)=> {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid refund request ID" });
      return;
    }

    const refund = await RefundRequest.findById(id)
      .populate({
        path: "policy",
        populate: [
          { path: "zone", select: "zoneName" },
          { path: "subCategory", select: "categoryName" },
        ],
      })
      .populate({
        path: "booking",
        populate: {
          path: "marketplaceListingId",
          select: "name zone subCategory",
        },
      })
      .populate("user", "name email");

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

// Update Refund Request
export const updateRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { id } = req.params;

    const refund = await RefundRequest.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!refund) {
      res.status(404).json({ message: "Refund request not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Refund request updated",
      data: refund,
    });
  }
);

// Delete Refund Request
export const deleteRefundRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const refund = await RefundRequest.findByIdAndDelete(id);
    if (!refund) {
      res.status(404).json({ message: "Refund request not found" });
      return;
    }
    res.status(200).json({ success: true, message: "Refund request deleted" });
  }
);

// Update Refund Request Status (Admin only)
export const updateRefundStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!["pending", "accept", "reject"].includes(status)) {
      res.status(400).json({ message: "Invalid status value" });
      return;
    }

    const refund = await RefundRequest.findById(id);
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
