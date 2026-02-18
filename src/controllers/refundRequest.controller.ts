import { Request, Response, NextFunction } from "express";
import { RefundRequest } from "../models/refundRequest.model";
import { RefundPolicy } from "../models/refundPolicy.model";
import { Booking } from "../models/booking.model";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { paginateQuery } from "../utils/paginate";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { sendNotification } from "../utils/notifications";
import { WalletTransaction } from "../models/walletTransaction.model";
import { capitalizeName } from "../utils/capitalizeName";
import { User } from "../models/user.model";

// Create Refund Request
export const createRefundRequest = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const { booking, reason, note } = req.body;

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
      deduction,
      totalRefundAmount,
      policy: policy._id,
      user: req.user?.id,
      note
    });

    res.status(201).json({
      success: true,
      message: "Refund request submitted successfully",
      data: refund,
    });
  }
);

// Get My Refund Requests
export const getMyRefundRequests = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const filter: any = {};

    const baseQuery = RefundRequest.find(filter)
      .populate("policy")
      .populate({
        path: "booking",
        populate: {
          path: "marketplaceListingId"
        },
      })
      .populate("user")
      ;

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
// export const getMyRefundRequests = asyncHandler(
//   async (req: Request & { user?: any }, res: Response) => {
//     const page = Number(req.query.page) || 1;
//     const limit = Number(req.query.limit) || 10;

//     const filter: any = { user: req.user?.id };

//     const baseQuery = RefundRequest.find(filter)
//       .populate("policy")
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

// Get Refund Request by ID

export const getRefundRequestById = asyncHandler(
  async (req: Request & { user?: any }, res: Response) => {
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
export const updateRefundStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const { status } = req.body;

    if (!["pending", "accept", "reject"].includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Invalid status value",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const refund = await RefundRequest.findById(id)
      .populate("booking")
      .populate("user")
      .session(session);

    if (!refund) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Refund request not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    if (refund.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Refund request already processed",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const admin = await User.findOne({ role: "admin" });

    if (!admin) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Admin not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    const booking = await Booking.findById(refund.booking)
      .populate("renter", "wallet email name fcmToken")
      .populate("leaser", "wallet email name fcmToken")
      .populate("marketplaceListingId", "name")
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Booking not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    const renter = booking.renter as any;
    const leaser = booking.leaser as any;

    const adminFee = booking.priceDetails.adminFee;
    const tax = booking.priceDetails.tax;

    const listingName =
      (booking.marketplaceListingId as any)?.name || "listing";

    // ================= REJECT =================
    if (status === "reject") {
      refund.status = "reject";
      await refund.save({ session });

      await session.commitTransaction();
      session.endSession();

      await sendNotification(
        renter._id.toString(),
        "Refund Rejected",
        `Your refund request for "${capitalizeName(listingName)}" has been rejected.`,
        {
          refundId: (refund._id as any).toString(),
          bookingId: booking._id.toString(),
          type: "refund",
          status: "rejected",
        }
      );

      return sendResponse(
        res,
        refund,
        "Refund request rejected",
        STATUS_CODES.OK
      );
    }

    // ================= ACCEPT =================
    const refundAmount = refund.totalRefundAmount || 0;
    const leaserAmount = refund.totalRefundAmount - (adminFee + tax) + (refund?.deduction || 0);
    const adminCollection = refund?.deduction || 0;

    if (!leaser?.wallet || leaser.wallet.balance < refundAmount) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        {
          requiredAmount: refundAmount.toFixed(2),
          currentBalance: leaser.wallet?.balance?.toFixed(2) || 0,
        },
        "Leaser has insufficient wallet balance for refund",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // Wallet movement
    leaser.wallet.balance -= leaserAmount;
    renter.wallet.balance += refundAmount;
    admin.wallet.balance += refund?.deduction || 0;
    // admin.wallet.balance -= adminFee + tax;

    await leaser.save({ session });
    await renter.save({ session });
    await admin.save({ session });

    await WalletTransaction.insertMany(
      [
        {
          userId: renter._id,
          type: "credit",
          amount: refundAmount.toFixed(2),
          source: "refund",
          status: "succeeded"
        },
        {
          userId: leaser._id,
          type: "debit",
          amount: leaserAmount.toFixed(2),
          source: "refund",
          status: "succeeded",
        },
        {
          userId: admin._id,
          type: "credit",
          amount: adminCollection.toFixed(2),
          source: "refund",
          status: "succeeded",
        }
      ],
      { session }
    );

    refund.status = "accept";
    await refund.save({ session });

    booking.status = "cancelled";
    await booking.save({ session })

    await session.commitTransaction();
    session.endSession();

    // ================= NOTIFICATIONS =================
    await sendNotification(
      renter._id.toString(),
      "Refund Approved",
      `You received a refund of $${refundAmount.toFixed(2)} for "${capitalizeName(listingName)}".`,
      {
        refundId: (refund._id as any).toString(),
        bookingId: booking._id.toString(),
        type: "refund",
        status: "approved",
        creditedAmount: refundAmount.toFixed(2),
      }
    );

    await sendNotification(
      leaser._id.toString(),
      "Refund Processed",
      `A refund of $${leaserAmount.toFixed(2)} has been deducted from your wallet for "${capitalizeName(listingName)}".`,
      {
        refundId: (refund._id as any).toString(),
        bookingId: booking._id.toString(),
        type: "refund",
        status: "approved",
        deductedAmount: leaserAmount.toFixed(2),
      }
    );

    // ================= ADMIN NOTIFICATION =================
    await sendNotification(
      admin._id as string,
      "Refund Settlement Processed",
      `The refund for "${capitalizeName(listingName)}" has been finalized. A service deduction of $${adminCollection.toFixed(2)} has been successfully collected and added to your balance.`,
      {
        refundId: (refund._id as any).toString(),
        bookingId: booking._id.toString(),
        type: "refund",
        status: "approved",
        collectedDeduction: adminCollection.toFixed(2),
        totalRenterRefund: refundAmount.toFixed(2),
      }
    );

    booking.status = "cancelled"

    return sendResponse(
      res,
      refund,
      "Refund processed successfully",
      STATUS_CODES.OK
    );
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

