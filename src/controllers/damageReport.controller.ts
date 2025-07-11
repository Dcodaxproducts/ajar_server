import { Request, Response, NextFunction } from "express";
import { DamageReport } from "../models/damageReport.model";
import { Booking } from "../models/booking.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

// POST /api/damage-report
export const createDamageReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId, rentalText, issueType, additionalFees } = req.body;
    const attachments = (req.files as Express.Multer.File[] || []).map(file => file.path);

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    const report = await DamageReport.create({
      bookingId,
      rentalText,
      issueType,
      additionalFees,
      attachments,
    });

    sendResponse(res, report, "Damage report submitted", STATUS_CODES.CREATED);
  } catch (err) {
    next(err);
  }
};
