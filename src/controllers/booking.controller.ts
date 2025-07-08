import { Request, Response, NextFunction } from "express";
import { Booking } from "../models/booking.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";

// CREATE
export const createBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;

    if (!user || !user.id) {
      return sendResponse(res, null, "Unauthenticated", STATUS_CODES.UNAUTHORIZED);
    }

    const {
      marketplaceListingId,
      dates,
      noOfGuests,
      roomType,
      phone,
      priceDetails,
      extensionCharges,
      language,
      languages,
      bookingNote,
    } = req.body;

    const newBooking = await Booking.create({
      marketplaceListingId,
      userId: user.id,
      dates,
      noOfGuests,
      roomType,
      phone,
      priceDetails,
      extensionCharges,
      language,
      languages,
      bookingNote,
    });

    sendResponse(res, newBooking, "Booking created successfully", STATUS_CODES.CREATED);
  } catch (err) {
    next(err);
  }
};


// GET ALL BOOKINGS (Admin)
export const getAllBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const baseQuery = Booking.find()
      .populate("marketplaceListingId")
      .lean() as any;

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    return sendResponse(res, {
      statusCode: STATUS_CODES.OK,
      success: true,
      message: "Bookings retrieved successfully",
      data: {
        bookings: data,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};


// GET ONE
export const getBookingById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const languageHeader = req.headers["language"];
    const locale =
      typeof languageHeader === "string"
        ? languageHeader.toLowerCase()
        : Array.isArray(languageHeader) && languageHeader.length > 0
        ? languageHeader[0].toLowerCase()
        : "en";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const booking = await Booking.findById(id).populate("marketplaceListingId").lean();

    if (!booking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (Array.isArray(booking.languages)) {
      const match = booking.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        booking.roomType = match.translations.roomType || booking.roomType;
        (booking as any).bookingNote = match.translations.bookingNote || (booking as any).bookingNote;
      }
    }
    delete booking.languages;

    sendResponse(res, booking, `Booking found (locale: ${locale})`, STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// Get by user ID
export const getBookingsByUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = (req as any).user;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const baseQuery = Booking.find({ userId: user.id })
      .populate("marketplaceListingId")
      .lean() as any;

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    return sendResponse(res, {
      statusCode: STATUS_CODES.OK,
      success: true,
      message: "Bookings retrieved successfully",
      data: {
        bookings: data,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};

// UPDATE
export const updateBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedBooking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, updatedBooking, "Booking updated successfully", STATUS_CODES.OK);
  } catch (err: any) {
    sendResponse(res, null, err.message || "Failed to update booking", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// DELETE
export const deleteBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const deleted = await Booking.findByIdAndDelete(id);
    if (!deleted) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }
    sendResponse(res, deleted, "Booking deleted", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};