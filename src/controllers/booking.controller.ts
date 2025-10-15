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

import { isBookingDateAvailable } from "../utils/dateValidator";

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
    if (!user) return res.status(401).json({ message: "Unauthorised" });

    const { marketplaceListingId, dates, extensionDate, ...bookingData } = req.body;

    // Validate listing id
    if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
      return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
    }

    const listing = await MarketplaceListing.findById(marketplaceListingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    // -----------------------------------------------------
    // Detect extension if renter already has active booking
    // -----------------------------------------------------
    const existingActiveBooking = await Booking.findOne({
      renter: user.id,
      marketplaceListingId: listing._id,
      "bookingDates.handover": { $ne: null },
      $or: [
        { "bookingDates.returnDate": { $exists: false } },
        { "bookingDates.returnDate": null },
      ],
    });

    // ---------------------- EXTENSION REQUEST ----------------------
    if (existingActiveBooking) {
      // extensionDate is required
      if (!extensionDate) {
        return res.status(400).json({ message: "Extension date is required" });
      }

      // ✅ FIXED: use existingActiveBooking.dates instead of bookingDates
      const checkInDate = new Date(existingActiveBooking.dates?.checkIn as Date);
      const checkOutDate = new Date(extensionDate);

      if (checkOutDate <= checkInDate) {
        return res.status(400).json({
          message: "Extension date must be after the current booking's check-in date",
        });
      }

      // Check extension date availability
      const isAvailableForExtend = await isBookingDateAvailable(
        listing._id as Types.ObjectId,
        checkInDate,
        checkOutDate,
        existingActiveBooking._id as Types.ObjectId
      );

      if (!isAvailableForExtend) {
        return res.status(400).json({
          message: "The listing is not available for the selected extended date.",
        });
      }

      // ✅ Create extension booking request
      const form = await Form.findOne({
        subCategory: listing.subCategory,
        zone: listing.zone,
      });
      if (!form) return res.status(400).json({ message: "Form not found for this listing" });

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

      const extendedBooking = await Booking.create({
        ...bookingData,
        dates: {
          // ✅ FIXED: use dates.checkIn instead of bookingDates.checkIn
          checkIn: existingActiveBooking.dates?.checkIn,
          checkOut: checkOutDate,
        },
        renter: user.id,
        leaser: listing.leaser,
        status: "pending",
        marketplaceListingId: listing._id,
        priceDetails,
        isExtend: false,
        previousBookingId: existingActiveBooking._id,
        
        // ✅ ADD THIS LINE
        extensionRequestedDate: checkOutDate,
      });

      return res.status(201).json({
        message: "Extension request created successfully.",
        booking: extendedBooking,
      });
    }

    // -----------------------------------------------------
    // Normal booking
    // -----------------------------------------------------
    if (!dates?.checkIn || !dates?.checkOut) {
      return res
        .status(400)
        .json({ message: "Booking dates (checkIn & checkOut) are required" });
    }

    const checkInDate = new Date(dates.checkIn);
    const checkOutDate = new Date(dates.checkOut);

    // Check base availability
    const isAvailable = await isBookingDateAvailable(
      listing._id as Types.ObjectId,
      checkInDate,
      checkOutDate
    );
    if (!isAvailable) {
      return res.status(400).json({
        message:
          "Listing is already booked for the selected dates. Please choose different dates.",
      });
    }

    // Fetch form
    const form = await Form.findOne({
      subCategory: listing.subCategory,
      zone: listing.zone,
    });
    if (!form) return res.status(400).json({ message: "Form not found for this listing" });

    // Document checks
    const requiredUserDocs = form.userDocuments || [];
    if (requiredUserDocs.length > 0) {
      const renterProfile = await User.findById(user.id);
      if (!renterProfile) return res.status(404).json({ message: "Renter profile not found" });

      const missingDocs: string[] = [];
      const unapprovedDocs: string[] = [];

      for (const requiredDoc of requiredUserDocs) {
        const userDoc = renterProfile.documents.find((doc: any) => doc.name === requiredDoc);
        if (!userDoc) missingDocs.push(requiredDoc);
        else if (userDoc.status !== "approved") unapprovedDocs.push(requiredDoc);
      }

      if (missingDocs.length > 0) {
        return res.status(400).json({
          message: `Booking requires the following document(s): ${missingDocs.join(", ")}`,
        });
      }

      if (unapprovedDocs.length > 0) {
        return res.status(400).json({
          message: `The following document(s) are not approved yet: ${unapprovedDocs.join(", ")}.`,
        });
      }
    }

    // Price calculation
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

    const newBooking: IBooking = await Booking.create({
      ...bookingData,
      dates: { checkIn: checkInDate, checkOut: checkOutDate },
      renter: user.id,
      leaser: listing.leaser,
      status: "pending",
      marketplaceListingId: listing._id,
      priceDetails,
    });

    (listing as any).currentBookingId = [newBooking._id as Types.ObjectId];
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

// Get bookings by user (renter, leaser, or both) with optional zone + status filters
  export const getBookingsByUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const user = (req as any).user;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const status = req.query.status as string | undefined;
      const role = req.query.role as string | undefined;
      const zone = req.query.zone as string | undefined;

      // --- Build dynamic filter ---
      const filter: any = {};

      if (role === "renter") {
        filter.renter = user.id;
      } else if (role === "leaser") {
        filter.leaser = user.id;
      } else {
        filter.$or = [{ renter: user.id }, { leaser: user.id }];
      }

      if (status) filter.status = status;

      // --- Query base ---
      let baseQuery = Booking.find(filter)
        .populate({
          path: "marketplaceListingId",
          match: zone ? { zone } : {},
          populate: {
            path: "zone",
            select: "name",
          },
        })
        .populate("renter", "firstName lastName email")
        .populate("leaser", "firstName lastName email")
        .sort({ createdAt: -1 })
        .lean();

      const allBookings = await baseQuery;

      const filteredBookings = zone
        ? allBookings.filter((b) => b.marketplaceListingId !== null)
        : allBookings;

      // ======================================================
      // 🔹 CHANGE #1: Organise child (extension) bookings under parent
      // ======================================================
      const bookingsMap: Record<string, any> = {};

      // First, store all bookings by ID
      filteredBookings.forEach((booking) => {
        bookingsMap[booking._id.toString()] = { ...booking, extensions: [] };
      });

      // Then, attach child bookings to their parent
      filteredBookings.forEach((booking) => {
        if (booking.previousBookingId) {
          const parent = bookingsMap[booking.previousBookingId.toString()];
          if (parent) {
            const extensionCount = parent.extensions.length + 1;

            // ✅ Only include limited details (handover, returnDate)
            parent.extensions.push({
              name: `Extension ${extensionCount}`,
              handover: booking.bookingDates?.handover || null,
              returnDate: booking.bookingDates?.returnDate || null,
              extensionDate: booking.extensionRequestedDate || null, 
            });

            delete bookingsMap[booking._id.toString()]; // remove child from root list
          }
        }
      });

      // Final array of parent-only bookings (with extensions inside)
      const mergedBookings = Object.values(bookingsMap);

      // ======================================================
      // 🔹 CHANGE #2: Pagination now applies after merge
      // ======================================================
      const total = mergedBookings.length;
      const paginatedBookings = mergedBookings.slice(
        (page - 1) * limit,
        page * limit
      );

      // --- Send response ---
      return sendResponse(res, {
        statusCode: STATUS_CODES.OK,
        success: true,
        message: "Bookings retrieved successfully",
        data: {
          bookings: paginatedBookings,
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

//booking status update controller
export const updateBookingStatus = async (req: Request, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params; // this is the PARENT booking id
    const { status, additionalCharges, isExtendApproval } = req.body;
    const user = (req as any).user;
    const userId = user.id || user._id;

    // ======================================================
    // 🔹 FETCH PARENT BOOKING
    // ======================================================
    let parentBooking = await Booking.findById(id)
      .populate("renter", "email name")
      .populate("leaser")
      .populate("marketplaceListingId");

    if (!parentBooking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
    }

    const renterId =
      typeof parentBooking.renter === "object"
        ? (parentBooking.renter as any)?._id?.toString()
        : (parentBooking.renter as any)?.toString();

    const leaserId =
      typeof parentBooking.leaser === "object"
        ? (parentBooking.leaser as any)?._id?.toString()
        : (parentBooking.leaser as any)?.toString();

    const isRenter = userId?.toString() === renterId;
    const isLeaser = userId?.toString() === leaserId;

    const bookingIdString = parentBooking._id?.toString() as string;

    let finalStatus = status;

    // ======================================================
    // 🔹 EXTENSION APPROVAL LOGIC
    // ======================================================
    if (isExtendApproval) {
      const childBooking = await Booking.findOne({
        previousBookingId: id,
        status: "pending",
      });

      if (!childBooking) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(
          res,
          null,
          "No pending extension request found for this booking",
          STATUS_CODES.BAD_REQUEST
        );
      }

      if (additionalCharges && Number(additionalCharges) > 0) {
        finalStatus = "approved";
      } else {
        finalStatus = "rejected";
      }

      if (finalStatus === "approved") {
        const extendChargeAmount = Number(additionalCharges) || 0;

        if (extendChargeAmount <= 0) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(
            res,
            null,
            "Extension charges are required when approving an extended booking.",
            STATUS_CODES.BAD_REQUEST
          );
        }

        // ✅ Extract individual parts from parent booking
        const { price, adminFee, tax, totalPrice: baseTotal } = parentBooking.priceDetails || {};
        const previousExtra = parentBooking.extraRequestCharges?.additionalCharges || 0;

        // ✅ Calculate updated totals
        const afterExtra = baseTotal + previousExtra;
        const newTotalPrice = afterExtra + extendChargeAmount;

        // ✅ Update child booking
        childBooking.isExtend = true;
        childBooking.status = "approved";
        childBooking.extendCharges = {
          extendCharges: extendChargeAmount,
          totalPrice: newTotalPrice,
        };
        childBooking.priceDetails = {
          price,
          adminFee,
          tax,
          totalPrice: baseTotal,
        };
        childBooking.extraRequestCharges = {
          additionalCharges: previousExtra,
          totalPrice: afterExtra,
        };
        (childBooking as any).extensionRequestedDate = undefined;

        await childBooking.save({ session });

        // ======================================================
        // 🔹 HANDLE HANDOVER / RETURN DATE CHAINING LOGIC
        // ======================================================
        const parentId = childBooking.previousBookingId;
        if (parentId) {
          const previousBooking = await Booking.findById(parentId).session(session);

          if (previousBooking) {
            // 🟢 UPDATED: Save handover & returnDate in child booking
            const parentReturnDate =
              previousBooking.bookingDates?.returnDate || new Date();
            const handoverDate =
              parentReturnDate > new Date()
                ? previousBooking.bookingDates?.returnDate
                : new Date();

            // Case 1: First-time extension → assign parent's returnDate as child's handover
            childBooking.bookingDates = {
              ...childBooking.bookingDates,
              handover: handoverDate,
              returnDate: undefined, // new extension period, to be set on completion
            };

            // Case 2: Update parent booking's returnDate to mark end of its period
            previousBooking.bookingDates = {
              ...previousBooking.bookingDates,
              returnDate: handoverDate,
            };

            previousBooking.isExtend = true;
            await previousBooking.save({ session });

            // 🔹 Find the main ancestor booking and mark it extended
            let topParent = previousBooking;
            while (topParent.previousBookingId) {
              const grandParent = await Booking.findById(topParent.previousBookingId).session(session);
              if (!grandParent) break;
              topParent = grandParent;
            }

            if (topParent) {
              topParent.isExtend = true;
              await topParent.save({ session });
            }

            await childBooking.save({ session });
          }
        }

        // ✅ Update parent booking — keep status as approved
        parentBooking.isExtend = true;
        parentBooking.extendCharges = {
          extendCharges: extendChargeAmount,
          totalPrice: newTotalPrice,
        };
        parentBooking.priceDetails.totalPrice = baseTotal;
        parentBooking.extraRequestCharges = {
          additionalCharges: previousExtra,
          totalPrice: afterExtra,
        };

        await parentBooking.save({ session });

        await session.commitTransaction();
        session.endSession();

        return sendResponse(res, childBooking, "Extension approved successfully", STATUS_CODES.OK);
      }

      if (finalStatus === "rejected") {
        childBooking.status = "rejected";
        childBooking.isExtend = false;
        (childBooking as any).extensionRequestedDate = undefined;
        await childBooking.save({ session });

        await session.commitTransaction();
        session.endSession();

        return sendResponse(res, childBooking, "Extension request rejected", STATUS_CODES.OK);
      }
    }

    // ======================================================
    // 🔹 NORMAL APPROVAL (non-extension)
    // ======================================================
    const allowedStatuses = ["approved", "rejected", "completed", "cancelled"];
    if (!allowedStatuses.includes(finalStatus)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Invalid status", STATUS_CODES.BAD_REQUEST);
    }

    if (finalStatus === "cancelled" && !isRenter) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Only renter can cancel the booking", STATUS_CODES.FORBIDDEN);
    }

    if (["approved", "rejected", "completed"].includes(finalStatus) && !isLeaser) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, "Only leaser can change the booking status", STATUS_CODES.FORBIDDEN);
    }

    let updateFields: any = { status: finalStatus };
    let finalBooking: IBooking | null = null;
    let pin: string | undefined;

    if (finalStatus === "approved" && !isExtendApproval) {
      if (parentBooking.specialRequest) {
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

        const currentTotalPrice = parentBooking.priceDetails.totalPrice;
        const newGrandTotalPrice = currentTotalPrice + additionalAmount;

        updateFields = {
          ...updateFields,
          extraRequestCharges: {
            additionalCharges: additionalAmount,
            totalPrice: newGrandTotalPrice,
          },
        };
      }

      pin = generatePIN(4);
      updateFields.otp = pin;
    }

    // ✅ When leaser completes booking → set returnDate
    if (finalStatus === "completed") {
      updateFields["bookingDates.returnDate"] = new Date();
    }

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
    // 🔹 ADDITIONAL LOGIC FOR COMPLETION CHAIN
    // ======================================================
    if (finalStatus === "completed") {
      // 🔸 Find the last child booking (if any)
      const lastChild = await Booking.findOne({ previousBookingId: id }).sort({ createdAt: -1 });

      if (lastChild) {
        // ✅ Set last child's returnDate
        lastChild.bookingDates = {
          ...lastChild.bookingDates,
          returnDate: new Date(),
        };
        await lastChild.save({ session });
      }

      // ✅ Update parent booking's returnDate as well (handover completed)
      parentBooking.bookingDates = {
        ...parentBooking.bookingDates,
        returnDate: new Date(),
      };
      await parentBooking.save({ session });
    }

    // ======================================================
    // 🔹 UPDATE MARKETPLACE LISTING AVAILABILITY
    // ======================================================
    const listing = await MarketplaceListing.findById(finalBooking.marketplaceListingId);

    if (listing) {
      if (finalStatus === "approved") {
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

    return sendResponse(res, finalBooking, `Booking status updated to ${finalStatus}`, STATUS_CODES.OK);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// submitBookingPin
export const submitBookingPin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp) return sendResponse(res, null, "PIN is required", STATUS_CODES.BAD_REQUEST);
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);

    // fetch booking
    const booking = await Booking.findById(id).populate("renter", "email name");
    if (!booking) return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);

    // check OTP
    if (booking.otp !== otp)
      return sendResponse(res, null, "Invalid or expired PIN", STATUS_CODES.UNAUTHORIZED);

    const now = new Date();
    const checkIn = new Date(booking.dates.checkIn);
    const checkOut = new Date(booking.dates.checkOut);
    const twelveHoursBeforeCheckout = new Date(checkOut.getTime() - 12 * 60 * 60 * 1000);

    // ✅ Strict time validation
    if (now < checkIn) {
      return sendResponse(
        res,
        null,
        "PIN submission not allowed before check-in time.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (now > twelveHoursBeforeCheckout) {
      return sendResponse(
        res,
        null,
        "PIN submission not allowed within 12 hours before checkout.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ✅ Between check-in and (check-out - 12h)
    const isRunning = now >= checkIn && now <= twelveHoursBeforeCheckout;

    // CASE A: Active booking — record handover
    if (booking.status === "approved" && isRunning) {
      if (!booking.bookingDates) booking.bookingDates = {};
      if (!booking.bookingDates.handover) {
        booking.bookingDates.handover = now;
      }
      booking.otp = "";
      await booking.save();

      return sendResponse(res, booking, "PIN verified and handover recorded", STATUS_CODES.OK);
    }

    // CASE B: Create new booking (handover for new one)
    const newBookingData: any = {
      status: "approved",
      renter: booking.renter,
      leaser: booking.leaser,
      marketplaceListingId: booking.marketplaceListingId,
      dates: booking.dates,
      language: booking.language,
      otp: "",
      priceDetails: booking.priceDetails,
      extraRequestCharges: booking.extraRequestCharges,
      specialRequest: booking.specialRequest,
      isExtend: false,
      extensionRequestedDate: undefined,
      bookingDates: {
        handover: now,
        returnDate: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Find active booking for renter+listing
    const existingActive = await Booking.findOne({
      renter: booking.renter,
      marketplaceListingId: booking.marketplaceListingId,
      "bookingDates.returnDate": { $in: [null, undefined] },
      _id: { $ne: booking._id },
      status: "approved",
    });

    if (existingActive) {
      newBookingData.previousBookingId = existingActive._id;
      existingActive.isExtend = true;

      const prevTotal = existingActive.priceDetails?.totalPrice || 0;
      const prevExtendTotal = existingActive.extendCharges?.totalPrice || 0;
      existingActive.extendCharges = {
        extendCharges: prevTotal,
        totalPrice: prevTotal + prevExtendTotal,
      };
      await existingActive.save();
    }

    const createdNewBooking = await Booking.create(newBookingData);
    booking.otp = "";
    await booking.save();

    return sendResponse(res, createdNewBooking, "New running booking created and handover recorded", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};


