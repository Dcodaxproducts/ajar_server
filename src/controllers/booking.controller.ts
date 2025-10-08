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
import { Form } from "../models/form.model";


// Utility function to update listing availability
async function updateListingAvailability(
  listingId: mongoose.Types.ObjectId,
  status: string,
  bookingId?: mongoose.Types.ObjectId
) {
  const listing = await MarketplaceListing.findById(listingId);
  if (!listing) return;

  if (status === "approved" && bookingId) {
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

        const { marketplaceListingId, dates, ...bookingData } = req.body;

        // 1️⃣ Validate marketplaceListingId and fetch listing
        if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
            return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
        }

        const listing = await MarketplaceListing.findById(marketplaceListingId);
        if (!listing) {
            return res.status(404).json({ message: "Listing not found" });
        }

        // ✅ Check for overlapping bookings instead of isAvailable
        if (!dates?.checkIn || !dates?.checkOut) {
            return res.status(400).json({ message: "Booking dates (checkIn & checkOut) are required" });
        }

        const checkInDate = new Date(dates.checkIn);
        const checkOutDate = new Date(dates.checkOut);

        const isAvailable = await isBookingDateAvailable(listing._id as mongoose.Types.ObjectId, checkInDate, checkOutDate);
        if (!isAvailable) {
            return res.status(400).json({
                message: "Listing is already booked for the selected dates. Please choose different dates.",
            });
        }

        // 2️⃣ Fetch form and user documents (previous logic retained)
        const form = await Form.findOne({
            subCategory: listing.subCategory,
            zone: listing.zone,
        });

        if (!form) {
            return res.status(400).json({ message: "Form not found for this listing" });
        }

        const requiredUserDocs = form.userDocuments || [];
        console.log("Required user documents for booking:", requiredUserDocs);

        if (requiredUserDocs.length > 0) {
            const renterProfile = await User.findById(user.id);
            if (!renterProfile) {
                return res.status(404).json({ message: "Renter profile not found" });
            }

            const missingDocs: string[] = [];
            const unapprovedDocs: string[] = [];

            for (const requiredDoc of requiredUserDocs) {
                const userDoc = renterProfile.documents.find(doc => doc.name === requiredDoc);

                if (!userDoc) {
                    missingDocs.push(requiredDoc);
                } else if (userDoc.status !== "approved") {
                    unapprovedDocs.push(requiredDoc);
                }
            }

            if (missingDocs.length > 0) {
                return res.status(400).json({
                    message: `Booking requires the following document(s) to be uploaded: ${missingDocs.join(", ")}`,
                });
            }

            if (unapprovedDocs.length > 0) {
                return res.status(400).json({
                    message: `The following document(s) are not yet approved: ${unapprovedDocs.join(", ")}. Please wait for verification.`,
                });
            }
        }

        // 3️⃣ Calculate Price Details based on Listing and Form
        const basePrice = listing.price;
        const renterCommissionRate = form.setting.renterCommission.value / 100;
        const leaserCommissionRate = form.setting.leaserCommission.value / 100;
        const taxRate = form.setting.tax / 100;

        const totalCommissionRate = renterCommissionRate + leaserCommissionRate;

        const commissionAmount = basePrice * totalCommissionRate;
        const taxAmount = (basePrice + commissionAmount) * taxRate;
        const finalPrice = basePrice + commissionAmount + taxAmount;

        const priceDetails = {
            price: basePrice,
            adminFee: commissionAmount,
            tax: taxAmount,
            totalPrice: finalPrice,
        };

        // 4️⃣ Create new booking
        const newBooking: IBooking = await Booking.create({
            ...bookingData,
            dates: { checkIn: checkInDate, checkOut: checkOutDate },
            renter: user.id,
            leaser: listing.leaser,
            status: "pending",
            marketplaceListingId: listing._id,
            priceDetails: priceDetails, // Save calculated price details
        });

        // 5️⃣ Update marketplace listing with this booking ID
        listing.currentBookingId = [newBooking._id as Types.ObjectId];
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
      | "approved"
      | "rejected"
      | "cancelled"
      | "completed"
      | undefined;

    const filter: any = {};
    if (
      status &&
      ["pending", "approved", "rejected", "cancelled", "completed"].includes(
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
     const extension = booking.extraRequestCharges?.totalPrice || 0;
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
// Get bookings by user role and zone
export const getBookingsByUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = (req as any).user;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const status = req.query.status;      // optional status filter
    const role = req.query.role as string; // "renter" or "leaser"
    const zone = req.query.zone as string; // optional zone filter

    // Build filter based on role
    let filter: any = {};

    if (role === "renter") {
      filter.renter = user.id;
    } else if (role === "leaser") {
      filter.leaser = user.id;
    } else {
      // no role filter: get bookings where user is either renter or leaser
      filter.$or = [{ renter: user.id }, { leaser: user.id }];
    }

    // Add status filter if provided
    if (status) {
      filter.status = status;
    }

    // Build query with optional zone filter
    let baseQuery = Booking.find(filter)
      .populate({
        path: "marketplaceListingId",
        match: zone ? { zone: zone } : {}, // filter by zone if provided
      })
      .lean() as any;

    // If zone filter is applied, remove bookings with null marketplaceListingId
    if (zone) {
      baseQuery = baseQuery.where("marketplaceListingId").ne(null);
    }

    // Apply pagination
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
import  {generatePIN}  from "../utils/generatePin"; // helper for generating 4 or 6 digit PIN

export const updateBookingStatus = async (req: Request, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status, additionalCharges, isExtendApproval } = req.body;
    const user = (req as any).user;

    // ✅ Ensure we handle both id and _id from token payload
    const userId = user.id || user._id;

    console.log("Authenticated User ID:", userId);
    console.log("Booking ID:", id);

    const allowedStatuses = ["approved", "rejected", "completed", "cancelled"];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid status", STATUS_CODES.BAD_REQUEST);
    }

    let booking = await Booking.findById(id)
      .populate("renter", "email name")
      .populate("leaser")
      .populate("marketplaceListingId");

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    // ✅ Handle both populated and non-populated IDs correctly
    const renterId =
      typeof booking.renter === "object"
        ? (booking.renter as any)?._id?.toString()
        : (booking.renter as any)?.toString();

    const leaserId =
      typeof booking.leaser === "object"
        ? (booking.leaser as any)?._id?.toString()
        : (booking.leaser as any)?.toString();

    console.log("Booking renter ID:", renterId);
    console.log("Booking leaser ID:", leaserId);

    const isRenter = userId?.toString() === renterId;
    const isLeaser = userId?.toString() === leaserId;

    console.log("isLeaser:", isLeaser, "isRenter:", isRenter);

    const bookingIdString = booking._id?.toString() as string;

    // ======================================================
    // 🔹 Role Restrictions
    // ======================================================
    if (status === "cancelled" && !isRenter) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Only renter can cancel the booking", STATUS_CODES.FORBIDDEN);
    }

    if (["approved", "rejected", "completed"].includes(status) && !isLeaser) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Only leaser can change the booking status", STATUS_CODES.FORBIDDEN);
    }

    let updateFields: any = { status: status };
    let finalBooking: IBooking | null = null;
    let pin: string | undefined;

    // ======================================================
    // 🔹 EXTENSION APPROVAL
    // ======================================================
    if (isExtendApproval) {
      const newCheckOut = (booking as any).extensionRequestedDate;

      if (!newCheckOut) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(res, null, "No pending extension request found", STATUS_CODES.BAD_REQUEST);
      }

      if (status === "approved") {
        booking.dates.checkOut = newCheckOut;
        (booking as any).isExtend = true;
        booking.status = "approved";

        await booking.save({ session });
        await session.commitTransaction();
        session.endSession();

        return sendResponse(res, booking, "Extension approved successfully", STATUS_CODES.OK);
      }

      if (status === "rejected") {
        (booking as any).extensionRequestedDate = undefined;
        (booking as any).isExtend = false;
        booking.status = "rejected";

        await booking.save({ session });
        await session.commitTransaction();
        session.endSession();

        return sendResponse(res, booking, "Extension request rejected", STATUS_CODES.OK);
      }
    }

    // ======================================================
    // 🔹 NORMAL APPROVAL (with optional additional charges)
    // ======================================================
    if (status === "approved" && !isExtendApproval) {
      if (booking.specialRequest) {
        const additionalAmount = Number(additionalCharges) || 0;

        if (additionalAmount <= 0) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(
            res,
            null,
            "Additional charges are required when approving a booking with a special request.",
            STATUS_CODES.BAD_REQUEST
          );
        }

        const currentTotalPrice = booking.priceDetails.totalPrice;
        const newGrandTotalPrice = currentTotalPrice + additionalAmount;

        updateFields = {
          ...updateFields,
          extraRequestCharges: {
            additionalCharges: additionalAmount,
            totalPrice: newGrandTotalPrice,
          },
        };
      }

      // ✅ Generate a 4-digit OTP using helper
      pin = generatePIN(4);
      updateFields.otp = pin;
    }

    // ======================================================
    // 🔹 UPDATE BOOKING RECORD
    // ======================================================
    finalBooking = await Booking.findByIdAndUpdate(id, { $set: updateFields }, { new: true }).populate(
      "renter",
      "email name"
    );

    if (!finalBooking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Booking update failed", STATUS_CODES.INTERNAL_SERVER_ERROR);
    }

    // ======================================================
    // 🔹 UPDATE MARKETPLACE LISTING AVAILABILITY
    // ======================================================
    const listing = await MarketplaceListing.findById(finalBooking.marketplaceListingId);

    if (listing) {
      if (status === "approved") {
        listing.isAvailable = false;
        listing.currentBookingId = [
          ...(listing.currentBookingId || []).filter((item) => item.toString() !== bookingIdString),
          finalBooking._id as mongoose.Types.ObjectId,
        ];
      } else {
        listing.isAvailable = true;
        listing.currentBookingId = (listing.currentBookingId || []).filter(
          (item) => item.toString() !== bookingIdString
        );
      }

      await listing.save();
    }

    await session.commitTransaction();
    session.endSession();

    return sendResponse(res, finalBooking, `Booking status updated to ${status}`, STATUS_CODES.OK);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};



// export const updateBookingStatus = async (req: Request, res: Response, next: NextFunction) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { id } = req.params;
//     const { status, additionalCharges, isExtendApproval } = req.body;
//     const user = (req as any).user;

//     const allowedStatuses = ["approved", "rejected", "completed", "cancelled"];
//     if (!allowedStatuses.includes(status)) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Invalid status", STATUS_CODES.BAD_REQUEST);
//     }

//     let booking = await Booking.findById(id)
//       .populate("renter", "email name")
//       .populate("leaser")
//       .populate("marketplaceListingId");

//     if (!booking) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
//     }

//     const isRenter = user.id === booking.renter.toString();
//     const isLeaser = user.id === booking.leaser?.toString();
//     const bookingIdString = booking._id?.toString() as string;

//     // ======================================================
//     // 🔹 Role Restrictions
//     // ======================================================
//     if (status === "cancelled" && !isRenter) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Only renter can cancel the booking", STATUS_CODES.FORBIDDEN);
//     }

//     if (["approved", "rejected", "completed"].includes(status) && !isLeaser) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Only leaser can change the booking status", STATUS_CODES.FORBIDDEN);
//     }

//     let updateFields: any = { status: status };
//     let finalBooking: IBooking | null = null;
//     let pin: string | undefined;

//     // ======================================================
//     // 🔹 EXTENSION APPROVAL
//     // ======================================================
//     if (isExtendApproval) {
//       const newCheckOut = (booking as any).extensionRequestedDate;

//       if (!newCheckOut) {
//         await session.abortTransaction();
//         session.endSession();
//         return sendResponse(
//           res,
//           null,
//           "No pending extension request found",
//           STATUS_CODES.BAD_REQUEST
//         );
//       }

//       if (status === "approved") {
//         booking.dates.checkOut = newCheckOut;
//         (booking as any).isExtend = true;
//         booking.status = "approved";

//         await booking.save({ session });
//         await session.commitTransaction();
//         session.endSession();

//         return sendResponse(res, booking, "Extension approved successfully", STATUS_CODES.OK);
//       }

//       if (status === "rejected") {
//         (booking as any).extensionRequestedDate = undefined;
//         (booking as any).isExtend = false;
//         booking.status = "rejected";

//         await booking.save({ session });
//         await session.commitTransaction();
//         session.endSession();

//         return sendResponse(res, booking, "Extension request rejected", STATUS_CODES.OK);
//       }
//     }

//     // ======================================================
//     // 🔹 NORMAL APPROVAL (with optional additional charges)
//     // ======================================================
//     if (status === "approved" && !isExtendApproval) {
//       if (booking.specialRequest) {
//         const additionalAmount = Number(additionalCharges) || 0;

//         if (additionalAmount <= 0) {
//           await session.abortTransaction();
//           session.endSession();
//           return sendResponse(
//             res,
//             null,
//             "Additional charges are required when approving a booking with a special request.",
//             STATUS_CODES.BAD_REQUEST
//           );
//         }

//         const currentTotalPrice = booking.priceDetails.totalPrice;
//         const newGrandTotalPrice = currentTotalPrice + additionalAmount;

//         updateFields = {
//           ...updateFields,
//           extensionCharges: {
//             additionalCharges: additionalAmount,
//             totalPrice: newGrandTotalPrice,
//           },
//         };
//       }

//       // Generate a 4-digit OTP and store in booking
//       pin = Math.floor(1000 + Math.random() * 9000).toString();
//       updateFields.otp = pin;
//     }

//     // ======================================================
//     // 🔹 UPDATE BOOKING RECORD
//     // ======================================================
//     finalBooking = await Booking.findByIdAndUpdate(
//       id,
//       { $set: updateFields },
//       { new: true }
//     ).populate("renter", "email name");

//     if (!finalBooking) {
//       await session.abortTransaction();
//       session.endSession();
//       return sendResponse(res, null, "Booking update failed", STATUS_CODES.INTERNAL_SERVER_ERROR);
//     }

//     // ======================================================
//     // 🔹 NO EMAIL — PIN SHOWN IN DETAILS
//     // ======================================================
//     // PIN (otp) is part of booking details, not emailed.

//     // ======================================================
//     // 🔹 UPDATE MARKETPLACE LISTING AVAILABILITY
//     // ======================================================
//     const listing = await MarketplaceListing.findById(finalBooking.marketplaceListingId);

//     if (listing) {
//       if (status === "approved") {
//         listing.isAvailable = false;
//         listing.currentBookingId = [
//           ...(listing.currentBookingId || []).filter(
//             (item) => item.toString() !== bookingIdString
//           ),
//           finalBooking._id as mongoose.Types.ObjectId,
//         ];
//       } else {
//         listing.isAvailable = true;
//         listing.currentBookingId = (listing.currentBookingId || []).filter(
//           (item) => item.toString() !== bookingIdString
//         );
//       }

//       await listing.save();
//     }

//     await session.commitTransaction();
//     session.endSession();

//     return sendResponse(res, finalBooking, `Booking status updated to ${status}`, STATUS_CODES.OK);
//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();
//     next(err);
//   }
// };


// submitBookingPin
export const submitBookingPin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp) return sendResponse(res, null, "PIN is required", STATUS_CODES.BAD_REQUEST);
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);

    const booking = await Booking.findById(id).populate("renter", "email name");
    if (!booking) return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);

    const now = new Date();
    const checkIn = new Date(booking.dates.checkIn);
    const checkOut = new Date(booking.dates.checkOut);

    // Allow OTP submission only within checkIn → (checkOut - 12h)
    const twelveHoursBeforeCheckout = new Date(checkOut.getTime() - 12 * 60 * 60 * 1000);

    if (now < checkIn)
      return sendResponse(res, null, "Cannot enter PIN before check-in time", STATUS_CODES.BAD_REQUEST);

    if (now > twelveHoursBeforeCheckout)
      return sendResponse(res, null, "PIN cannot be submitted after 12 hours before checkout", STATUS_CODES.BAD_REQUEST);

    if (booking.otp !== otp)
      return sendResponse(res, null, "Invalid or expired PIN", STATUS_CODES.UNAUTHORIZED);

    booking.otp = "";
    await booking.save();

    sendResponse(res, booking, "PIN verified successfully", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};


import { isBookingDateAvailable } from "../utils/dateValidator";

export const requestExtendBooking = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { newCheckOut } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);

    const booking = await Booking.findById(id);
    if (!booking) return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);

    if (!user || String(booking.renter) !== String(user.id))
      return sendResponse(res, null, "Only renter can request an extension", STATUS_CODES.FORBIDDEN);

    const newCheckOutDate = new Date(newCheckOut);
    if (newCheckOutDate <= new Date(booking.dates.checkOut))
      return sendResponse(res, null, "New checkout date must be later than current checkout date", STATUS_CODES.BAD_REQUEST);

    // check overlap with other approved/pending bookings
    const isAvailable = await isBookingDateAvailable(
      booking.marketplaceListingId,
      booking.dates.checkIn,
      newCheckOutDate,
      booking._id as mongoose.Types.ObjectId

    );

    if (!isAvailable)
      return sendResponse(res, null, "Extension not allowed — next booking overlaps with requested dates", STATUS_CODES.BAD_REQUEST);

    // mark extension request
    (booking as any).isExtend = false;
    (booking as any).extensionRequestedDate = newCheckOutDate;

    await booking.save();

    sendResponse(res, booking, "Extension request submitted successfully", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

export const applyExtensionCharges = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { extensionCharges } = req.body; // The extension charge amount (number)

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    // Only leaser can apply extension charges
    if (!user || String(booking.leaser) !== String(user.id)) {
      return sendResponse(res, null, "Only leaser can apply extension charges", STATUS_CODES.FORBIDDEN);
    }

    // Check if extension request exists
    const newCheckOut = booking.extensionRequestedDate;
    if (!newCheckOut) {
      return sendResponse(res, null, "No pending extension request found", STATUS_CODES.BAD_REQUEST);
    }

    // Check for overlapping bookings
    const isAvailable = await isBookingDateAvailable(
      booking.marketplaceListingId,
      booking.dates.checkIn,
      newCheckOut,
      booking._id as mongoose.Types.ObjectId
    );

    if (!isAvailable) {
      return sendResponse(res, null, "Extension not allowed — dates overlap with another booking", STATUS_CODES.BAD_REQUEST);
    }

    // Apply extension
    booking.dates.checkOut = newCheckOut;
    booking.isExtend = true;
    booking.extensionRequestedDate = undefined;

    // Preserve previous totals
    const baseTotal = booking.priceDetails.totalPrice; // price + adminFee + tax
    const previousExtra = booking.extraRequestCharges?.additionalCharges || 0;
    const previousExtraTotal = booking.extraRequestCharges?.totalPrice || baseTotal + previousExtra;

    // Keep extraRequestCharges unchanged
    booking.extraRequestCharges = {
      additionalCharges: previousExtra,
      totalPrice: previousExtraTotal,
    };

    // Apply extension charges
    if (extensionCharges && extensionCharges > 0) {
      (booking as any).extendCharges = {
        extendCharges: extensionCharges,
        totalPrice: previousExtraTotal + extensionCharges,
      };
    }

    await booking.save();

    return sendResponse(
      res,
      booking,
      "Extension charges applied successfully",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};
