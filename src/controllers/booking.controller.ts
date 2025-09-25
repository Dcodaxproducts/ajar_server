import { Request, Response, NextFunction } from "express";
import { Booking, IBooking }   from "../models/booking.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { sendEmail } from "../helpers/node-mailer";
import { User } from "../models/user.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Types } from "mongoose";


// Utility function to update listing availability
async function updateListingAvailability(
  listingId: mongoose.Types.ObjectId,
  status: string,
  bookingId?: mongoose.Types.ObjectId
) {
  const listing = await MarketplaceListing.findById(listingId);
  if (!listing) return;

  if (status === "accepted" && bookingId) {
    if (!listing.currentBookingIds.includes(bookingId)) {
      listing.currentBookingIds.push(bookingId);
    }
    listing.isAvailable = false;
  } else if (
    ["rejected", "completed", "cancelled"].includes(status) &&
    bookingId
  ) {
    listing.currentBookingIds = listing.currentBookingIds.filter(
      (id: mongoose.Types.ObjectId) =>
        id.toString() !== bookingId.toString()
    );

    if (listing.currentBookingIds.length === 0) {
      listing.isAvailable = true;
    }
  }

  await listing.save();
}

// Create booking controller
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorised" });
    }

    const { marketplaceListingId, ...bookingData } = req.body;

    const listing = await MarketplaceListing.findById(marketplaceListingId);
    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    if (!listing.isAvailable) {
      return res.status(400).json({ message: "Listing is not available" });
    }

    // 1️⃣ Create new booking
    const newBooking: IBooking = await Booking.create({
      ...bookingData,
      renter: user.id,
      leaser: listing.leaser,
      status: "pending",
      marketplaceListingId: listing._id,
    });

    // 2️⃣ Update marketplace listing with this booking ID
      listing.currentBookingId = [newBooking._id as Types.ObjectId]; 
    // keep isAvailable true for now, will flip false when accepted
    await listing.save();

    return res.status(201).json({
      message: "Booking created successfully",
      booking: newBooking,
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    return res.status(500).json({ message: "Server error", error });
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

    const status = req.query.status as
      | "pending"
      | "accepted"
      | "rejected"
      | "cancelled"
      | "completed"
      | undefined;

    const filter: any = {};
    if (
      status &&
      ["pending", "accepted", "rejected", "cancelled", "completed"].includes(
        status
      )
    ) {
      filter.status = status;
    }

    // FIX: Remove `.lean()` from baseQuery
    const baseQuery = Booking.find(filter).populate("marketplaceListingId");

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    const now = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const monthlyCount = await Booking.countDocuments({
      createdAt: { $gte: oneMonthAgo, $lte: now },
    });

    const yearlyCount = await Booking.countDocuments({
      createdAt: { $gte: oneYearAgo, $lte: now },
    });

    const allBookings = await Booking.find(filter).lean();

    const totalEarning = allBookings.reduce((acc, booking) => {
      const price = booking.priceDetails?.totalPrice || 0;
      const extension = booking.extensionCharges?.totalPrice || 0;
      return acc + price + extension;
    }, 0);

    return sendResponse(res, {
      statusCode: STATUS_CODES.OK,
      message: "Bookings retrieved successfully",
      data: {
        bookings: data,
        total,
        page,
        limit,
        monthlyRequest: monthlyCount,
        yearlyRequest: yearlyCount,
        totalEarning,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET BOOKINGS BY USER ID (Admin)
export const getBookingsByUserIdForAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendResponse(
        res,
        null,
        "Invalid user ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const baseQuery = Booking.find({ renter: userId })
      .populate("marketplaceListingId")
      .lean() as any;

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    return sendResponse(
      res,
      {
        bookings: data,
        total,
        page,
        limit,
      },
      "User bookings retrieved successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// GET ONE
export const getBookingById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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

    const booking = await Booking.findById(id)
      .populate("marketplaceListingId")
      .populate("renter")
      .lean();

    if (!booking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (Array.isArray(booking.languages)) {
      const match = booking.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        booking.roomType = match.translations.roomType || booking.roomType;
        (booking as any).bookingNote =
          match.translations.bookingNote || (booking as any).bookingNote;
      }
    }
    delete booking.languages;

    sendResponse(
      res,
      booking,
      `Booking found (locale: ${locale})`,
      STATUS_CODES.OK
    );
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

    // Extract status from query
    const status = req.query.status;

    // Build filter conditionally
    const filter: any = { renter: user.id };
    if (status) {
      filter.status = status;
    }

    // Apply the filter
    const baseQuery = Booking.find(filter)
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
export const updateBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const user = (req as any).user; //Added to get current user info

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const booking = await Booking.findById(id); //Fetch booking first to check roles
    if (!booking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    //Check if `actualReturnedAt` is being updated
    if (
      "actualReturnedAt" in req.body &&
      (!user || String(user.id) !== String(booking.leaser))
    ) {
      return sendResponse(
        res,
        null,
        "Only the leaser can update 'actualReturnedAt'",
        STATUS_CODES.FORBIDDEN
      );
    }

    //Apply all updates (safe since schema is dynamic via `strict: false`)
    Object.assign(booking, req.body);

    const updatedBooking = await booking.save(); //Save after manual update

    sendResponse(
      res,
      updatedBooking,
      "Booking updated successfully",
      STATUS_CODES.OK
    );
  } catch (err: any) {
    sendResponse(
      res,
      null,
      err.message || "Failed to update booking",
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

// DELETE
export const deleteBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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


// PATCH /bookings/:id/status
export const updateBookingStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const user = (req as any).user;

    const allowedStatuses = ["accepted", "rejected", "completed", "cancelled"];
    if (!allowedStatuses.includes(status)) {
      return sendResponse(res, null, "Invalid status", STATUS_CODES.BAD_REQUEST);
    }

    const booking = await Booking.findById(id).populate("renter", "email name");
    if (!booking) {
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    const isRenter =
      typeof booking.renter === "object" && "_id" in booking.renter
        ? user.id === (booking.renter as any)._id.toString()
        : user.id === booking.renter.toString();

    const isLeaser = user.id === booking.leaser?.toString();

    // Restrictions
    if (status === "cancelled" && !isRenter) {
      return sendResponse(res, null, "Only renter can cancel the booking", STATUS_CODES.FORBIDDEN);
    }
    if (["accepted", "rejected", "completed"].includes(status) && !isLeaser) {
      return sendResponse(res, null, "Only leaser can change the booking status", STATUS_CODES.FORBIDDEN);
    }

    booking.status = status as any;

    // If accepted → generate OTP
    if (status === "accepted") {
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      booking.otp = pin;

      const userInfo = booking.renter as any;
      await sendEmail({
        to: userInfo.email,
        name: userInfo.name,
        subject: "Your Booking Confirmation PIN",
        content: `Dear ${userInfo.name},\n\nYour booking has been accepted. Your confirmation PIN is: ${pin}`,
      });
    }

    await booking.save();

    // 🔧 Update MarketplaceListing
    const listing = await MarketplaceListing.findById(booking.marketplaceListingId);
    if (listing) {
      if (status === "accepted") {
        listing.isAvailable = false;
        // ✅ Explicitly cast booking._id to ObjectId
        listing.currentBookingId = [
          ...(listing.currentBookingId || []),
          booking._id as Types.ObjectId,
        ];
      } else {
        listing.isAvailable = true;
        listing.currentBookingId = []; // clear when not accepted
      }
      await listing.save();
    }

    sendResponse(res, booking, `Booking status updated to ${status}`, STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// export const updateBookingStatus = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;
//     const user = (req as any).user;

//     const allowedStatuses = ["accepted", "rejected", "completed", "cancelled"];
//     if (!allowedStatuses.includes(status)) {
//       return sendResponse(
//         res,
//         null,
//         "Invalid status",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     const booking = await Booking.findById(id).populate("renter", "email name");
//     if (!booking) {
//       return sendResponse(
//         res,
//         null,
//         "Booking not found",
//         STATUS_CODES.NOT_FOUND
//       );
//     }

//     const isRenter =
//       typeof booking.renter === "object" && "_id" in booking.renter
//         ? user.id === (booking.renter as any)._id.toString()
//         : user.id === booking.renter.toString();

//     const isLeaser = user.id === booking.leaser?.toString();

//     // Restriction logic
//     if (status === "cancelled") {
//       if (!isRenter) {
//         return sendResponse(
//           res,
//           null,
//           "Only renter can cancel the booking",
//           STATUS_CODES.FORBIDDEN
//         );
//       }
//     } else {
//       if (!isLeaser) {
//         return sendResponse(
//           res,
//           null,
//           "Only leaser can change the booking status",
//           STATUS_CODES.FORBIDDEN
//         );
//       }
//     }

//     const bookingToUpdate = await Booking.findById(id);
//     if (!bookingToUpdate) {
//       return sendResponse(
//         res,
//         null,
//         "Booking not found",
//         STATUS_CODES.NOT_FOUND
//       );
//     }

//     bookingToUpdate.status = status as any;

//     // If accepted → send OTP
//     if (status === "accepted") {
//       const pin = Math.floor(1000 + Math.random() * 9000).toString();
//       bookingToUpdate.otp = pin;

//       const userInfo = booking.renter as any;
//       await sendEmail({
//         to: userInfo.email,
//         name: userInfo.name,
//         subject: "Your Booking Confirmation PIN",
//         content: `Dear ${userInfo.name},\n\nYour booking has been accepted. Your confirmation PIN is: ${pin}`,
//       });
//     }

//     await bookingToUpdate.save();

//     // Update listing availability + currentBookingId
//     const listing = await MarketplaceListing.findById(
//       bookingToUpdate.marketplaceListingId
//     );

//     if (listing) {
//       if (status === "accepted") {
//         listing.isAvailable = false;
//         listing.currentBookingId = bookingToUpdate._id;
//       } else {
//         // rejected / completed / cancelled
//         listing.isAvailable = true;
//         listing.currentBookingId = null;
//       }
//       await listing.save();
//     }

//     sendResponse(
//       res,
//       bookingToUpdate,
//       `Booking status updated to ${status}`,
//       STATUS_CODES.OK
//     );
//   } catch (err) {
//     next(err);
//   }
// };

//submit booking pin
export const submitBookingPin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return sendResponse(
        res,
        null,
        "PIN is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        "Invalid booking ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const booking = await Booking.findById(id).populate("renter", "email name");
    if (!booking) {
      return sendResponse(
        res,
        null,
        "Booking not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    if (booking.otp !== otp) {
      return sendResponse(
        res,
        null,
        "Invalid or Expire PIN",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    booking.otp = "";
    await booking.save();

    sendResponse(res, booking, "PIN verified successfully", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};
