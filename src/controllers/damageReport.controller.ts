import { Request, Response, NextFunction } from "express";
import { DamageReport } from "../models/damageReport.model";
import { Booking } from "../models/booking.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { AuthRequest } from "../middlewares/auth.middleware";


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

    const attachments = (
      (req.files as { [fieldname: string]: Express.Multer.File[] })?.attachments || []
    ).map((file) => file.path);

    // Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
    }

    // Find booking
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    // Parse numeric values safely
    const damageAmount = Number(damagedCharges) || 0;

    // 🧾 Create the damage report
    const report = await DamageReport.create({
      booking: booking._id,
      rentalText,
      issueType,
      damagedCharges: damageAmount,
      attachments,
      user: req.user?.id,
      status: status || "pending",
    });

    // 💰 Calculate the new total price including all charges
    const baseTotal = booking.priceDetails?.totalPrice || 0;
    const extraTotal = booking.extraRequestCharges?.additionalCharges || 0;
    const extendTotal = booking.extendCharges?.extendCharges || 0;

    // If booking already has damage charges, add to them
    const existingDamage = booking.damagesCharges?.damagedCharges || 0;
    const newTotalDamage = existingDamage + damageAmount;

    // Calculate final updated total
    const updatedTotal = baseTotal + extraTotal + extendTotal + newTotalDamage;

    // Update booking damage details
    booking.damagesCharges = {
      damagedCharges: newTotalDamage,
      totalPrice: updatedTotal,
    };

    await booking.save();

    // Populate for response
    const updatedBooking = await Booking.findById(bookingId)
      .populate("marketplaceListingId")
      .populate("renter")
      .populate("leaser");

    // ✅ Send success response
    sendResponse(
      res,
      {
        report,
        booking: updatedBooking,
      },
      "Damage report submitted and booking updated successfully",
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

    // 🟢 Admin → get all reports (no filter)
    if (role === "admin") {
      // no restrictions — admin sees everything
    }

    // 🔵 Renter → only reports created by themselves
    else if (role === "renter") {
      queryObj.user = userId;
    }

    // 🟠 Leaser → reports linked to bookings for their listings
    else if (role === "leaser") {
      // Step 1: find all booking IDs owned by this leaser
      const bookings = await Booking.find({ leaser: userId }).select("_id");
      const bookingIds = bookings.map((b) => b._id);

      // Step 2: restrict damage reports to those bookings
      queryObj.booking = { $in: bookingIds };
    }

    // 🧩 Optional: Filter by status (pending/resolved)
    if (status && ["pending", "resolved"].includes(status)) {
      queryObj.status = status;
    }

    // 🧩 Query with population
    const query = DamageReport.find(queryObj)
      .populate({
        path: "booking",
        populate: [
          { path: "renter", select: "firstName lastName email" },
          { path: "leaser", select: "firstName lastName email" },
          { path: "marketplaceListingId", select: "title zone" },
        ],
      })
      .populate("user", "firstName lastName email role");

    const paginated = await paginateQuery(query, { page, limit });

    sendResponse(
      res,
      {
        reports: paginated.data,
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

    // Only admin can update status
    if (userRole !== "admin") {
      return sendResponse(res, null, "Unauthorized", STATUS_CODES.UNAUTHORIZED);
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, null, "Invalid report ID", STATUS_CODES.BAD_REQUEST);
    }

    if (!["pending", "resolved"].includes(status)) {
      return sendResponse(res, null, "Invalid status value", STATUS_CODES.BAD_REQUEST);
    }

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
      return sendResponse(res, null, "Report not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(
      res,
      updatedReport,
      "Damage report status updated successfully",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};
