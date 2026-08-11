import { Request, Response, NextFunction } from "express";
import { RefundRequest } from "../models/refundRequest.model";
import { Booking } from "../models/booking.model";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { paginateQuery } from "../utils/paginate";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { notificationQueue } from "../queues/notification.queue";
import { capitalizeName } from "../utils/capitalizeName";
import { User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import { refundBookingPaymentAmount } from "../utils/bookingStripePayments";

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
        populate: [
          { path: "marketplaceListingId" },
          {
            path: "refundRequest",
            select:
              "status reason totalRefundAmount deduction note createdAt isEarlyReturn breakdown securityDeposit",
          },
        ],
      })
      .populate("user")
      // Newest first, and without it paginated pages can repeat or skip rows
      .sort({ createdAt: -1 });

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

// Get My Refund Requests by Id
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
        populate: [
          { path: "marketplaceListingId", select: "name zone subCategory" },
          {
            path: "refundRequest",
            select:
              "status reason totalRefundAmount deduction note createdAt isEarlyReturn breakdown securityDeposit",
          },
        ],
      })
      .populate("user", "name email profilePicture");

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
    const { status, adminNote } = req.body;

    if (!["pending", "accept", "reject"].includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid status value", STATUS_CODES.BAD_REQUEST);
    }

    if (status === "reject" && (!adminNote || adminNote.trim() === "")) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "A rejection note is required to process this request", STATUS_CODES.BAD_REQUEST);
    }

    const refund = await RefundRequest.findById(id)
      .populate("booking")
      .populate("user")
      .session(session);

    if (!refund) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Refund request not found", STATUS_CODES.NOT_FOUND);
    }

    if (refund.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Refund request already processed", STATUS_CODES.BAD_REQUEST);
    }

    const admin = await User.findOne({ role: "admin" });
    if (!admin) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Admin not found", STATUS_CODES.NOT_FOUND);
    }

    const booking = await Booking.findById(refund.booking)
      .populate("renter", "wallet email name fcmToken")
      .populate("leaser", "wallet email name fcmToken")
      .populate("marketplaceListingId", "name")
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    if (adminNote) {
      booking.refundNote = adminNote;
    }

    const renter = booking.renter as any;
    const leaser = booking.leaser as any;

    const adminFee = booking.priceDetails.adminFee;
    const tax = booking.priceDetails.tax;
    const listingName = (booking.marketplaceListingId as any)?.name || "listing";

    // ================= REJECT =================
    if (status === "reject") {
      refund.status = "reject";
      await refund.save({ session });
      await booking.save({ session });

      await session.commitTransaction();
      session.endSession();

      // Transaction is already committed — a queue failure must not fail the request
      try {
        await notificationQueue.add("refund-rejected", {
          userId: renter._id.toString(),
          title: "Refund Rejected",
          message: `Your refund request for "${capitalizeName(listingName)}" has been rejected.`,
          data: {
            refundId: (refund._id as any).toString(),
            bookingId: booking._id.toString(),
            type: "refund",
            status: "rejected",
          },
        });
      } catch (err) {
        console.error("Failed to queue refund rejection notification:", err);
      }

      return sendResponse(res, refund, "Refund request rejected", STATUS_CODES.OK);
    }

    // ================= ACCEPT =================
    const refundAmount = parseFloat(Number(refund.totalRefundAmount ?? 0).toFixed(2));
    const securityDeposit = parseFloat(Number(refund.securityDeposit ?? 0).toFixed(2));
    const isEarlyReturn = Boolean(refund.isEarlyReturn);

    // An early return keeps the platform fee — the rental actually ran — and
    // leaves the deposit to settle through the dispute window instead
    const totalRenterCredit = isEarlyReturn
      ? refundAmount
      : parseFloat((refundAmount + adminFee + tax + securityDeposit).toFixed(2));

    const capturedAmount = parseFloat(
      (
        Number(booking.priceDetails?.totalPrice || 0) +
        Number(booking.priceDetails?.securityDeposit || 0)
      ).toFixed(2)
    );

    // Pre-pickup cancellation: single booking, single PaymentIntent — unchanged
    if (!isEarlyReturn && totalRenterCredit > 0) {
      await refundBookingPaymentAmount(booking._id, totalRenterCredit, session);
      await Payment.findOneAndUpdate(
        {
          bookingId: booking._id,
          type: { $in: ["booking", "extension"] },
          status: { $in: ["captured", "payout_pending", "partially_refunded"] },
        },
        {
          status: totalRenterCredit >= capturedAmount ? "refunded" : "partially_refunded",
          refundedAt: new Date(),
        },
        { session }
      );
    }

    refund.status = "accept";
    await refund.save({ session });
    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Early return: every extension is its own booking with its own
    // PaymentIntent, so each one is refunded separately. Runs after the commit
    // and stamps each line as Stripe confirms it, so a retry can pick up where
    // it stopped instead of refunding twice.
    if (isEarlyReturn) {
      for (const line of refund.breakdown) {
        if (line.refundedAt || line.refundAmount <= 0) continue;

        try {
          await refundBookingPaymentAmount(line.booking, line.refundAmount);

          // Always partial: the deposit is part of the same charge and is
          // settled later through the dispute window, so the PaymentIntent is
          // never fully refunded at this point.
          await Payment.findOneAndUpdate(
            {
              bookingId: line.booking,
              type: { $in: ["booking", "extension"] },
              status: { $in: ["captured", "payout_pending", "partially_refunded"] },
            },
            {
              status: "partially_refunded",
              refundedAt: new Date(),
            }
          );

          line.refundedAt = new Date();
          await refund.save();
        } catch (err) {
          console.error(
            `Early return refund failed for booking ${line.booking}:`,
            err
          );
        }
      }

      // Extensions follow the parent out of the rental
      await Booking.updateMany(
        { previousBookingId: booking._id, status: { $ne: "booking_cancelled" } },
        {
          $set: {
            status: "booking_cancelled",
            cancelledFromStatus: "in_progress",
          },
        }
      );
    }

    // ================= NOTIFICATIONS =================

    // Renter
    const depositLine = isEarlyReturn
      ? securityDeposit > 0
        ? ` Your security deposit of $${securityDeposit.toFixed(2)} stays on hold until the damage dispute window closes.`
        : ""
      : securityDeposit > 0
        ? ` (includes $${securityDeposit.toFixed(2)} security deposit)`
        : "";

    const renterMsg = totalRenterCredit > 0
      ? isEarlyReturn
        ? `Your early return request for "${capitalizeName(listingName)}" has been approved. $${totalRenterCredit.toFixed(2)} will be refunded to the original payment method.${depositLine}`
        : `Your refund request for "${capitalizeName(listingName)}" has been approved. $${totalRenterCredit.toFixed(2)} will be refunded to the original payment method${depositLine}.`
      : `Your refund request for "${capitalizeName(listingName)}" has been approved (No monetary refund applicable).`;

    // Stripe refund is already done and the transaction committed — a queue
    // failure must not fail the request
    try {
      await notificationQueue.add("refund-approved", {
        userId: renter._id.toString(),
        title: "Refund Approved",
        message: renterMsg,
        data: {
          refundId: (refund._id as any).toString(),
          bookingId: booking._id.toString(),
          type: "refund",
          status: "approved",
          creditedAmount: totalRenterCredit.toFixed(2),
          securityDepositReturned: securityDeposit.toFixed(2),
        },
      });

      // Admin — one notification for the whole debit. The deposit is already
      // part of totalRenterCredit on a pre-pickup cancellation, so announcing
      // it separately would read as if twice the money left the platform.
      const adminDepositLine =
        !isEarlyReturn && securityDeposit > 0
          ? ` (includes $${securityDeposit.toFixed(2)} security deposit)`
          : "";

      await notificationQueue.add("refund-processed", {
        userId: admin._id as string,
        title: "Refund Processed",
        message: `A refund of $${totalRenterCredit.toFixed(2)} has been returned to the renter for "${capitalizeName(listingName)}"${adminDepositLine}.`,
        data: {
          refundId: (refund._id as any).toString(),
          bookingId: booking._id.toString(),
          type: "refund",
          status: "approved",
          debitedAmount: totalRenterCredit.toFixed(2),
          depositReturned: isEarlyReturn ? "0.00" : securityDeposit.toFixed(2),
        },
      });

    } catch (err) {
      console.error("Failed to queue refund notifications:", err);
    }

    return sendResponse(res, refund, "Refund processed successfully", STATUS_CODES.OK);

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

