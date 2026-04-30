import { Request, Response, NextFunction } from "express";
import { DamageReport } from "../models/damageReport.model";
import { Booking } from "../models/booking.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { AuthRequest } from "../middlewares/auth.middleware";
import { sendNotification } from "../utils/notifications";
import { User } from "../models/user.model";
import { WalletTransaction } from "../models/walletTransaction.model";

// POST /api/damage-report
export const createDamageReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      booking: bookingId,
      rentalText,
      issueType,
      damagedCharges,
      status,
    } = req.body;

    const userId = req.user?.id;

    const attachments = (
      (req.files as { [fieldname: string]: Express.Multer.File[] })
        ?.attachments || []
    ).map((file) => `/uploads/${file.filename}`);

    // 1. Validate booking ID format
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendResponse(
        res,
        null,
        "Invalid booking ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // 2. Check if a damage report already exists for this booking
    const existingReport = await DamageReport.findOne({ booking: bookingId });
    if (existingReport) {
      return sendResponse(
        res,
        null,
        "A damage report has already been submitted for this booking",
        STATUS_CODES.CONFLICT // 409 Conflict is appropriate here
      );
    }

    // 3. Find booking to ensure it exists and to get renter ID
    const booking = await Booking.findById(bookingId).populate("marketplaceListingId");
    if (!booking) {
      return sendResponse(
        res,
        null,
        "Booking not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    // if (booking.status !== "completed") {
    //   return sendResponse(
    //     res,
    //     null,
    //     "Damage report can only be created for completed bookings",
    //     STATUS_CODES.BAD_REQUEST
    //   );
    // }

    const leaserId = booking.leaser?.toString();
    if (leaserId !== userId) {
      return sendResponse(
        res,
        null,
        "Unauthorized: Only the leaser can create a damage report for this booking",
        STATUS_CODES.FORBIDDEN
      );
    }

    const damageAmount = Number(damagedCharges) || 0;

    // 4. Create the damage report
    const report = await DamageReport.create({
      booking: booking._id,
      rentalText,
      issueType,
      damagedCharges: damageAmount,
      attachments,
      user: req.user?.id,
      status: status || "pending",
    });

    // 5. Update the Booking Model with damage charges
    await Booking.findByIdAndUpdate(bookingId, {
      $set: {
        damagesCharges: {
          damagedCharges: damageAmount,
          totalPrice: damageAmount,
        },
      },
    });

    const listingName = (booking.marketplaceListingId as any)?.name || "your booking";

    // 6. Send Notification to the RENTER
    try {
      const admin = await User.findOne({ role: "admin" }).lean();

      if (admin) {
        await sendNotification(
          admin._id.toString(),
          "New Damage Report Filed",
          `A damage report has been submitted for "${listingName}". Amount: $${damageAmount.toFixed(2)}`,
          {
            bookingId: booking._id.toString(),
            reportId: report._id,
            type: "damage_report",
            status: "pending"
          }
        );
      }
    } catch (notificationErr) {
      console.error("Notification failed:", notificationErr);
    }

    // 7. Send success response
    sendResponse(
      res,
      { report },
      "Damage report submitted successfully",
      STATUS_CODES.CREATED
    );
  } catch (err) {
    next(err);
  }
};

// READ ALL (admin gets all, user gets their own)
export const getAllDamageReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id: userId, role } = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;

    const queryObj: any = {};

    //Admin → get all reports (no filter)
    if (role === "admin") {
      // no restrictions — admin sees everything
    }

    //Renter → only reports created by themselves
    else if (role === "renter") {
      queryObj.user = userId;
    }

    //Leaser → reports linked to bookings for their listings
    else if (role === "leaser") {
      // Step 1: find all booking IDs owned by this leaser
      const bookings = await Booking.find({ leaser: userId }).select("_id");
      const bookingIds = bookings.map((b) => b._id);

      // Step 2: restrict damage reports to those bookings
      queryObj.booking = { $in: bookingIds };
    }

    //Optional: Filter by status (pending/resolved)
    if (status && ["pending", "resolved"].includes(status)) {
      queryObj.status = status;
    }

    //Query with population
    const query = DamageReport.find(queryObj)
      .sort({ createdAt: -1 })
      .populate({
        path: "booking",
        populate: [
          { path: "renter", select: "name email" },
          { path: "leaser", select: "name email" },
          { path: "marketplaceListingId", select: "title zone" },
        ],
      })
      .populate("user", "name email role");

    const paginated = await paginateQuery(query, { page, limit });

    sendResponse(
      res,
      {
        tickets: paginated.data,
        total: paginated.total,
        page: paginated.page,
        limit: paginated.limit,
      },
      "Fetched successfully",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// READ ONE
export const getDamageReportById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        "Invalid report ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const report = await DamageReport.findById(id)
      .populate({
        path: "booking",
        select: "renter leaser dates.checkIn dates.checkOut priceDetails status",
        populate: [
          {
            path: "renter",
            select: "name email profilePicture"
          },
          {
            path: "leaser",
            select: "name email profilePicture"
          }
        ]
      });

    if (!report) {
      return sendResponse(res, null, "Not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, report, "Fetched successfully", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// UPDATE
export const updateDamageReport = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        "Invalid report ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const updatedReport = await DamageReport.findByIdAndUpdate(id, updateData, {
      new: true,
    })
      .populate("booking")
      .populate("user");

    if (!updatedReport) {
      return sendResponse(res, null, "Not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, updatedReport, "Updated successfully", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// DELETE
export const deleteDamageReport = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        "Invalid report ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const deletedReport = await DamageReport.findByIdAndDelete(id);
    if (!deletedReport) {
      return sendResponse(res, null, "Not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, null, "Deleted successfully", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/damage-report/:id/status
export const updateDamageReportStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body;
    const userRole = req.user?.role;

    // Only admin can update status
    if (userRole !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Only admin can update damage report status", STATUS_CODES.FORBIDDEN);
    }

    // Validate report ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid report ID", STATUS_CODES.BAD_REQUEST);
    }

    // Validate status value
    const allowedStatuses = ["pending", "approved", "rejected"];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid status value", STATUS_CODES.BAD_REQUEST);
    }

    // Find damage report with full details
    const damageReport = await DamageReport.findById(id)
      .populate({
        path: "booking",
        populate: [
          { path: "renter", select: "firstName lastName email wallet" },
          { path: "leaser", select: "firstName lastName email wallet" },
          { path: "marketplaceListingId", select: "name title zone" },
        ],
      })
      .populate("user", "firstName lastName email role")
      .session(session);

    if (!damageReport) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Damage report not found", STATUS_CODES.NOT_FOUND);
    }

    // Prevent re-processing already settled reports
    if (damageReport.status === "approved" || damageReport.status === "rejected") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "This damage report has already been settled", STATUS_CODES.BAD_REQUEST);
    }

    const bookingData = damageReport.booking as any;
    const listingName = bookingData?.marketplaceListingId?.name || bookingData?.marketplaceListingId?.title || "your listing";
    const damagedCharges = damageReport.damagedCharges || 0;
    const leaserId = bookingData?.leaser?._id?.toString();
    const renterId = bookingData?.renter?._id?.toString();

    // Determine who submitted the damage report
    const reportSubmittedBy = (damageReport.user as any)?._id?.toString();
    const isSubmittedByRenter = reportSubmittedBy === renterId;
    const isSubmittedByLeaser = reportSubmittedBy === leaserId;

    // ================= APPROVED =================
    if (status === "approved") {
      const admin = await User.findOne({ role: "admin" }).session(session);
      if (!admin) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(res, null, "Admin not found", STATUS_CODES.NOT_FOUND);
      }

      const depositAmount = bookingData?.priceDetails?.securityDeposit || 0;
      const remainingDeposit = depositAmount - damagedCharges;

      // Check admin wallet has enough for full deposit
      if (admin.wallet.balance < depositAmount) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(res, null, "Admin wallet has insufficient funds", STATUS_CODES.BAD_REQUEST);
      }

      // Deduct full deposit from admin escrow
      admin.wallet.balance -= depositAmount;
      await admin.save({ session });

      // Credit leaser with damaged charges
      const leaser = await User.findById(leaserId).session(session);
      if (leaser) {
        leaser.wallet.balance += damagedCharges;
        await leaser.save({ session });
      }

      // Credit renter with remaining deposit (if any)
      if (remainingDeposit > 0) {
        const renter = await User.findById(renterId).session(session);
        if (renter?.wallet) {
          renter.wallet.balance += remainingDeposit;
          await renter.save({ session });
        }
      }

      // Set security deposit to 0 on booking since fully settled
      await Booking.findByIdAndUpdate(
        bookingData._id,
        { $set: { "priceDetails.securityDeposit": 0 } },
        { session }
      );

      // Record wallet transactions
      const walletTxns: any[] = [
        {
          userId: admin._id,
          type: "debit",
          amount: depositAmount,
          source: "booking",
          status: "succeeded",
          note: `Full security deposit released from escrow for damage report on "${listingName}"`,
          createdAt: new Date(),
          requestedAt: new Date(),
          processedAt: new Date(),
        },
        {
          userId: leaserId,
          type: "credit",
          amount: damagedCharges,
          source: "booking",
          status: "succeeded",
          note: `Damage charge reimbursement for "${listingName}"`,
          createdAt: new Date(),
          requestedAt: new Date(),
          processedAt: new Date(),
        },
      ];

      if (remainingDeposit > 0) {
        walletTxns.push({
          userId: renterId,
          type: "credit",
          amount: remainingDeposit,
          source: "refund",
          status: "succeeded",
          note: `Remaining security deposit refunded after damage deduction for "${listingName}"`,
          createdAt: new Date(),
          requestedAt: new Date(),
          processedAt: new Date(),
        });
      }

      await WalletTransaction.insertMany(walletTxns, { session });

      damageReport.status = "approved";
      await damageReport.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        if (leaserId) {
          await sendNotification(
            leaserId,
            "Damage Report Approved",
            `Admin approved the damage report for "${listingName}". $${damagedCharges.toFixed(2)} has been credited to your wallet from the security deposit.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "approved" }
          );
        }

        if (renterId) {
          await sendNotification(
            renterId,
            "Damage Charges Deducted",
            remainingDeposit > 0
              ? `$${damagedCharges.toFixed(2)} has been deducted from your security deposit for the damage report on "${listingName}". Remaining deposit of $${remainingDeposit.toFixed(2)} has been refunded to your wallet.`
              : `$${damagedCharges.toFixed(2)} has been deducted from your full security deposit for the damage report on "${listingName}". No remaining deposit to refund.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "approved" }
          );
        }

        if (remainingDeposit > 0) {
          await sendNotification(
            renterId,
            "Partial Security Deposit Refunded",
            `Your remaining security deposit of $${remainingDeposit.toFixed(2)} for "${listingName}" has been refunded to your wallet after damage deduction.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "approved" }
          );
        }

        if (isSubmittedByLeaser) {
          await sendNotification(
            leaserId,
            "Your Damage Report Approved",
            `The damage report you submitted for "${listingName}" has been approved by admin. $${damagedCharges.toFixed(2)} has been credited to your wallet.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "approved" }
          );
        } else if (isSubmittedByRenter) {
          await sendNotification(
            renterId,
            "Your Damage Report Approved",
            `The damage report you submitted for "${listingName}" has been approved by admin.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "approved" }
          );
        }
      } catch (err) {
        console.error("Notification Error:", err);
      }

      return sendResponse(
        res,
        damageReport,
        `Damage report approved and $${damagedCharges.toFixed(2)} transferred to leaser successfully`,
        STATUS_CODES.OK
      );
    }

    // ================= REJECTED =================
    if (status === "rejected") {
      const admin = await User.findOne({ role: "admin" }).session(session);
      if (!admin) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(res, null, "Admin not found", STATUS_CODES.NOT_FOUND);
      }

      // Declare outside so notifications can access it
      const depositAmount = bookingData?.priceDetails?.securityDeposit || 0;

      if (depositAmount > 0) {
        if (admin.wallet.balance < depositAmount) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(res, null, "Admin wallet has insufficient funds to refund deposit", STATUS_CODES.BAD_REQUEST);
        }

        // Deduct from admin escrow
        admin.wallet.balance -= depositAmount;
        await admin.save({ session });

        // Credit full deposit back to renter
        const renter = await User.findById(renterId).session(session);
        if (renter?.wallet) {
          renter.wallet.balance += depositAmount;
          await renter.save({ session });
        }

        await WalletTransaction.insertMany([
          {
            userId: admin._id,
            type: "debit",
            amount: depositAmount,
            source: "refund",
            status: "succeeded",
            note: `Security deposit released from escrow — damage report rejected for "${listingName}"`,
            createdAt: new Date(),
            requestedAt: new Date(),
            processedAt: new Date(),
          },
          {
            userId: renterId,
            type: "credit",
            amount: depositAmount,
            source: "refund",
            status: "succeeded",
            note: `Security deposit refunded — damage report rejected for "${listingName}"`,
            createdAt: new Date(),
            requestedAt: new Date(),
            processedAt: new Date(),
          },
        ], { session });

        // Set security deposit to 0 on booking since fully settled
        await Booking.findByIdAndUpdate(
          bookingData._id,
          { $set: { "priceDetails.securityDeposit": 0 } },
          { session }
        );
      }

      damageReport.status = "rejected";
      await damageReport.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        if (leaserId) {
          await sendNotification(
            leaserId,
            "Damage Report Rejected",
            `Admin has rejected the damage report for "${listingName}". The renter's security deposit has been refunded.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" }
          );
        }

        if (renterId) {
          await sendNotification(
            renterId,
            "Damage Report Rejected",
            depositAmount > 0
              ? `The damage report for "${listingName}" has been rejected by admin. Your full security deposit of $${depositAmount.toFixed(2)} has been refunded to your wallet.`
              : `The damage report for "${listingName}" has been rejected by admin. No security deposit was held.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" }
          );
        }

        if (depositAmount > 0) {
          await sendNotification(
            renterId,
            "Security Deposit Refunded",
            `Your full security deposit of $${depositAmount.toFixed(2)} for "${listingName}" has been returned to your wallet as the damage report was rejected.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" }
          );
        }

        if (isSubmittedByRenter) {
          await sendNotification(
            renterId,
            "Your Damage Report Rejected",
            depositAmount > 0
              ? `The damage report you submitted for "${listingName}" has been rejected by admin. Your full security deposit of $${depositAmount.toFixed(2)} has been refunded to your wallet.`
              : `The damage report you submitted for "${listingName}" has been rejected by admin.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" }
          );
        } else if (isSubmittedByLeaser) {
          await sendNotification(
            leaserId,
            "Your Damage Report Rejected",
            `The damage report you submitted for "${listingName}" has been rejected by admin. The renter's full security deposit of $${depositAmount.toFixed(2)} has been refunded to them.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" }
          );
        }

        if (depositAmount > 0) {
          await sendNotification(
            admin._id as string,
            "Security Deposit Released",
            `The full security deposit of $${depositAmount.toFixed(2)} for "${listingName}" has been released from escrow and refunded to the renter after damage report rejection.`,
            { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" }
          );
        }
      } catch (err) {
        console.error("Notification Error:", err);
      }

      return sendResponse(res, null, "Damage report rejected successfully", STATUS_CODES.OK);
    }

    // ================= PENDING (reset) =================
    damageReport.status = "pending";
    await damageReport.save({ session });

    await session.commitTransaction();
    session.endSession();

    return sendResponse(res, damageReport, "Damage report status updated to 'pending' successfully", STATUS_CODES.OK);

  } catch (err) {
    console.error("Update Damage Report Error:", err);
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// export const updateReportStatus = async (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction
// ) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { bookingId, action } = req.body;
//     const renterId = req.user?.id;

//     // validate action
//     if (!["approve", "reject"].includes(action)) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Invalid action. Must be 'approve' or 'reject'", STATUS_CODES.BAD_REQUEST);
//     }

//     if (!mongoose.Types.ObjectId.isValid(bookingId)) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Invalid Booking ID", STATUS_CODES.BAD_REQUEST);
//     }

//     const damageReport = await DamageReport.findOne({ booking: bookingId })
//       .populate("booking")
//       .session(session);

//     if (!damageReport) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "No damage report found for this booking", STATUS_CODES.NOT_FOUND);
//     }

//     const bookingData = damageReport.booking as any;
//     const listingName = (bookingData.marketplaceListingId as any)?.name || "item";

//     if (bookingData.renter.toString() !== renterId) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "You are not authorized to action this damage report", STATUS_CODES.FORBIDDEN);
//     }

//     if (damageReport.status === "paid" || damageReport.status === "resolved" || damageReport.status === "rejected") {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "This damage report has already been settled", STATUS_CODES.BAD_REQUEST);
//     }

//     // ================= REJECT =================
//     if (action === "reject") {
//       damageReport.status = "rejected";
//       await damageReport.save({ session });

//       await session.commitTransaction();
//       session.endSession();

//       try {
//         await sendNotification(
//           renterId as string,
//           "Damage Report Rejected",
//           `You have rejected the damage report for "${listingName}".`,
//           { bookingId, type: "damage_report", status: "rejected" }
//         );

//         if (bookingData.leaser) {
//           await sendNotification(
//             bookingData.leaser.toString(),
//             "Damage Report Rejected",
//             `The renter has rejected the damage report for "${listingName}".`,
//             { bookingId, type: "damage_report", status: "rejected" }
//           );
//         }
//       } catch (err) { console.error("Notification Error:", err); }

//       return sendResponse(res, null, "Damage report rejected successfully", STATUS_CODES.OK);
//     }

//     // ================= APPROVE =================
//     const renter = await User.findById(renterId).session(session);
//     const leaser = await User.findById(bookingData.leaser).session(session);

//     if (!renter) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Renter not found", STATUS_CODES.NOT_FOUND);
//     }

//     const amountToPay = damageReport.damagedCharges;

//     if (renter.wallet.balance < amountToPay) {
//       try {
//         await sendNotification(
//           renterId as string,
//           "Payment Failed: Damage Charges",
//           `Insufficient funds ($${renter.wallet.balance.toFixed(2)}) to pay for damage charges on "${listingName}".`,
//           { bookingId, type: "payment_failed" }
//         );
//       } catch (err) { console.error("Notification Error:", err); }

//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(
//         res,
//         { currentBalance: renter.wallet.balance.toFixed(2), required: amountToPay.toFixed(2) },
//         "Insufficient wallet balance",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     renter.wallet.balance -= amountToPay;
//     await renter.save({ session });

//     if (leaser) {
//       leaser.wallet.balance += amountToPay;
//       await leaser.save({ session });
//     }

//     damageReport.status = "resolved";
//     await damageReport.save({ session });

//     const transactions = [
//       {
//         userId: renter._id,
//         type: "debit",
//         amount: amountToPay,
//         source: "booking",
//         status: "succeeded",
//         description: `Damage charge payment for listing: ${listingName}`,
//         createdAt: new Date(),
//         requestedAt: new Date(),
//         processedAt: new Date(),
//       },
//       {
//         userId: bookingData.leaser,
//         type: "credit",
//         amount: amountToPay,
//         source: "booking",
//         status: "succeeded",
//         description: `Damage charge reimbursement for listing: ${listingName}`,
//         createdAt: new Date(),
//         requestedAt: new Date(),
//         processedAt: new Date(),
//       }
//     ];

//     await WalletTransaction.insertMany(transactions, { session });

//     await session.commitTransaction();
//     session.endSession();

//     try {
//       await sendNotification(
//         renterId as string,
//         "Damage Payment Successful",
//         `$${amountToPay.toFixed(2)} deducted from wallet for damage settlement on "${listingName}".`,
//         { bookingId, status: "paid", type: "damage_report" }
//       );

//       if (bookingData.leaser) {
//         await sendNotification(
//           bookingData.leaser.toString(),
//           "Damage Payment Received",
//           `Renter paid $${amountToPay.toFixed(2)} for damage charges on "${listingName}".`,
//           { bookingId, type: "damage_resolved" }
//         );
//       }
//     } catch (err) { console.error("Final Notification Error:", err); }

//     sendResponse(res, null, "Damage report settled successfully", STATUS_CODES.OK);

//   } catch (err) {
//     console.error("Approval Error:", err);
//     await session.abortTransaction();
//     session.endSession();
//     next(err);
//   }
// };
