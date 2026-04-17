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

    if(booking.status !== "completed"){
      return sendResponse(
        res,
        null,
        "Damage report can only be created for completed bookings",
        STATUS_CODES.BAD_REQUEST
      );
    }

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
      await sendNotification(
        booking.renter.toString(),
        "New Damage Report Filed",
        `A damage report has been submitted for "${listingName}". Amount: $${damageAmount.toFixed(2)}`,
        {
          bookingId: booking._id.toString(),
          reportId: report._id,
          type: "damage_report",
          status: "pending"
        }
      );
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
      .populate("booking")
      .populate("user");

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
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userRole = req.user?.role;

    //Only admin can update status
    if (userRole !== "admin") {
      return sendResponse(
        res,
        null,
        "Only admin can update damage report status",
        STATUS_CODES.FORBIDDEN
      );
    }

    //Validate report ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        "Invalid report ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    //Validate status value (according to schema)
    const allowedStatuses = [
      "pending",
      "approved",
      "paid",
      "rejected",
      "resolved",
    ];
    if (!allowedStatuses.includes(status)) {
      return sendResponse(
        res,
        null,
        "Invalid status value",
        STATUS_CODES.BAD_REQUEST
      );
    }

    //Update report status
    const updatedReport = await DamageReport.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    )
      .populate({
        path: "booking",
        populate: [
          { path: "renter", select: "firstName lastName email" },
          { path: "leaser", select: "firstName lastName email" },
          { path: "marketplaceListingId", select: "title zone" },
        ],
      })
      .populate("user", "firstName lastName email role");

    if (!updatedReport) {
      return sendResponse(
        res,
        null,
        "Damage report not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    return sendResponse(
      res,
      updatedReport,
      `Damage report status updated to '${status}' successfully`,
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

export const updateReportStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId, action } = req.body;
    const renterId = req.user?.id;

    // validate action
    if (!["approve", "reject"].includes(action)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid action. Must be 'approve' or 'reject'", STATUS_CODES.BAD_REQUEST);
    }
    
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid Booking ID", STATUS_CODES.BAD_REQUEST);
    }

    const damageReport = await DamageReport.findOne({ booking: bookingId })
      .populate("booking")
      .session(session);

    if (!damageReport) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "No damage report found for this booking", STATUS_CODES.NOT_FOUND);
    }

    const bookingData = damageReport.booking as any;
    const listingName = (bookingData.marketplaceListingId as any)?.name || "item";

    if (bookingData.renter.toString() !== renterId) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "You are not authorized to action this damage report", STATUS_CODES.FORBIDDEN);
    }

    if (damageReport.status === "paid" || damageReport.status === "resolved" || damageReport.status === "rejected") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "This damage report has already been settled", STATUS_CODES.BAD_REQUEST);
    }

    // ================= REJECT =================
    if (action === "reject") {
      damageReport.status = "rejected";
      await damageReport.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        await sendNotification(
          renterId as string,
          "Damage Report Rejected",
          `You have rejected the damage report for "${listingName}".`,
          { bookingId, type: "damage_report", status: "rejected" }
        );

        if (bookingData.leaser) {
          await sendNotification(
            bookingData.leaser.toString(),
            "Damage Report Rejected",
            `The renter has rejected the damage report for "${listingName}".`,
            { bookingId, type: "damage_report", status: "rejected" }
          );
        }
      } catch (err) { console.error("Notification Error:", err); }

      return sendResponse(res, null, "Damage report rejected successfully", STATUS_CODES.OK);
    }

    // ================= APPROVE =================
    const renter = await User.findById(renterId).session(session);
    const leaser = await User.findById(bookingData.leaser).session(session);

    if (!renter) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Renter not found", STATUS_CODES.NOT_FOUND);
    }

    const amountToPay = damageReport.damagedCharges;

    if (renter.wallet.balance < amountToPay) {
      try {
        await sendNotification(
          renterId as string,
          "Payment Failed: Damage Charges",
          `Insufficient funds ($${renter.wallet.balance.toFixed(2)}) to pay for damage charges on "${listingName}".`,
          { bookingId, type: "payment_failed" }
        );
      } catch (err) { console.error("Notification Error:", err); }

      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        { currentBalance: renter.wallet.balance.toFixed(2), required: amountToPay.toFixed(2) },
        "Insufficient wallet balance",
        STATUS_CODES.BAD_REQUEST
      );
    }

    renter.wallet.balance -= amountToPay;
    await renter.save({ session });

    if (leaser) {
      leaser.wallet.balance += amountToPay;
      await leaser.save({ session });
    }

    damageReport.status = "resolved";
    await damageReport.save({ session });

    const transactions = [
      {
        userId: renter._id,
        type: "debit",
        amount: amountToPay,
        source: "booking",
        status: "succeeded",
        description: `Damage charge payment for listing: ${listingName}`,
        createdAt: new Date(),
        requestedAt: new Date(),
        processedAt: new Date(),
      },
      {
        userId: bookingData.leaser,
        type: "credit",
        amount: amountToPay,
        source: "booking",
        status: "succeeded",
        description: `Damage charge reimbursement for listing: ${listingName}`,
        createdAt: new Date(),
        requestedAt: new Date(),
        processedAt: new Date(),
      }
    ];

    await WalletTransaction.insertMany(transactions, { session });

    await session.commitTransaction();
    session.endSession();

    try {
      await sendNotification(
        renterId as string,
        "Damage Payment Successful",
        `$${amountToPay.toFixed(2)} deducted from wallet for damage settlement on "${listingName}".`,
        { bookingId, status: "paid", type: "damage_report" }
      );

      if (bookingData.leaser) {
        await sendNotification(
          bookingData.leaser.toString(),
          "Damage Payment Received",
          `Renter paid $${amountToPay.toFixed(2)} for damage charges on "${listingName}".`,
          { bookingId, type: "damage_resolved" }
        );
      }
    } catch (err) { console.error("Final Notification Error:", err); }

    sendResponse(res, null, "Damage report settled successfully", STATUS_CODES.OK);

  } catch (err) {
    console.error("Approval Error:", err);
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};
