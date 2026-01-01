import { Request, Response, NextFunction } from "express";
import { Booking, IBooking } from "../models/booking.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { sendEmail } from "../helpers/node-mailer";
import { IUser, User } from "../models/user.model";
import {
  IMarketplaceListing,
  MarketplaceListing,
} from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Types } from "mongoose";
import { Form } from "../models/form.model";
import { generatePIN } from "../utils/generatePin";
import { Review } from "../models/review.model";
import { isBookingDateAvailable } from "../utils/dateValidator";
import { sendNotification } from "../utils/notifications";
import { calculateBookingPrice } from "../utils/calculateBookingPrice";
import { Payment } from "../models/payment.model";

//NEW HELPER — detects date-only strings (YYYY-MM-DD)
const isDateOnly = (value: string) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
};

//NEW HELPER — normalize dates based on rule
const normalizeBookingDates = (checkInRaw: string, checkOutRaw: string) => {
  let checkIn = new Date(checkInRaw);
  let checkOut = new Date(checkOutRaw);

  //CHANGE: if both dates are date-only (NO time)
  if (isDateOnly(checkInRaw) && isDateOnly(checkOutRaw)) {
    // start of day
    checkIn.setUTCHours(0, 0, 0, 0);

    // end of day (23:59:59)
    checkOut.setUTCHours(23, 59, 59, 999);
  }

  return { checkIn, checkOut };
};



// createBooking
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user as { id: string; role: string };
    if (!user) return res.status(401).json({ message: "Unauthorised" });

    const { marketplaceListingId, dates, extensionDate, ...bookingData } =
      req.body;

    if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
      return res
        .status(400)
        .json({ message: "Invalid Marketplace Listing ID" });
    }

    const listing = await MarketplaceListing.findById(marketplaceListingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    const listingId = listing._id as Types.ObjectId;
    const leaserId = listing.leaser as Types.ObjectId;

    const renter = await User.findById(user.id);
    if (!renter) {
      return res.status(404).json({ message: "Renter not found" });
    }

    const existingActiveBooking = await Booking.findOne({
      renter: user.id,
      marketplaceListingId: listingId,
      "bookingDates.handover": { $ne: null },
      $or: [
        { "bookingDates.returnDate": { $exists: false } },
        { "bookingDates.returnDate": null },
      ],
    });

    if (existingActiveBooking) {
      if (!extensionDate) {
        return res.status(400).json({ message: "Extension date is required" });
      }

      const extensionStartDate = new Date(existingActiveBooking.dates.checkOut);
      const extensionEndDate = new Date(extensionDate);

      if (extensionEndDate <= extensionStartDate) {
        return res.status(400).json({
          message: "Extension date must be after previous checkout date",
        });
      }

      const isAvailableForExtend = await isBookingDateAvailable(
        listingId,
        extensionStartDate,
        extensionEndDate,
        existingActiveBooking._id
      );

      if (!isAvailableForExtend) {
        return res.status(400).json({
          message: "Listing is not available for the selected extension period",
        });
      }

      let duration = 0;
      const priceUnit = listing.priceUnit;

      switch (priceUnit) {
        case "hour":
          duration = Math.ceil(
            (extensionEndDate.getTime() - extensionStartDate.getTime()) /
            (1000 * 60 * 60)
          );
          break;

        case "day":
          duration = Math.ceil(
            (extensionEndDate.getTime() - extensionStartDate.getTime()) /
            (1000 * 60 * 60 * 24)
          );
          break;

        case "month":
          duration =
            (extensionEndDate.getFullYear() -
              extensionStartDate.getFullYear()) *
            12 +
            (extensionEndDate.getMonth() - extensionStartDate.getMonth());
          break;

        case "year":
          duration =
            extensionEndDate.getFullYear() - extensionStartDate.getFullYear();
          break;
      }

      const basePrice = duration * listing.price;

      const priceDetails = {
        price: basePrice,
        adminFee: 0,
        tax: 0,
        totalPrice: basePrice,
      };

      if (renter.wallet.balance < priceDetails.totalPrice) {
        return res.status(400).json({
          message:
            "Insufficient wallet balance to request extension. Please add funds.",
          requiredBalance: priceDetails.totalPrice,
          currentBalance: renter.wallet.balance,
        });
      }

      const extendedBooking = await Booking.create({
        ...bookingData,
        dates: {
          checkIn: existingActiveBooking.dates.checkIn,
          checkOut: extensionEndDate,
        },
        renter: user.id,
        leaser: leaserId,
        marketplaceListingId: listingId,
        status: "pending",
        priceDetails,
        pricingMeta: {
          priceFromListing: listing.price,
          unit: priceUnit,
          duration,
        },
        isExtend: false,
        previousBookingId: existingActiveBooking._id,
        extensionRequestedDate: extensionEndDate,
      });

      try {
        await sendNotification(
          leaserId.toString(),
          "New Extension Request",
          `Renter requested an extension for listing "${listing.name}".`,
          {
            bookingId: extendedBooking._id.toString(),
            listingId: listing._id.toString(),
            type: "extension",
            status: "pending",
          }
        );
      } catch (err) {
        console.error("Failed to notify leaser about extension request:", err);
      }

      return res.status(201).json({
        message: "Extension request created successfully",
        booking: extendedBooking,
        priceFromListing: {
          priceFromListing: listing.price,
          unit: priceUnit,
          duration,
        },
      });
    }

    if (!dates?.checkIn || !dates?.checkOut) {
      return res.status(400).json({
        message: "Booking dates (checkIn & checkOut) are required",
      });
    }


    //normalize date-only vs date-time input
    const { checkIn: checkInDate, checkOut: checkOutDate } =
      normalizeBookingDates(dates.checkIn, dates.checkOut);

    // const checkInDate = new Date(dates.checkIn);
    // const checkOutDate = new Date(dates.checkOut);

    const isAvailable = await isBookingDateAvailable(
      listingId,
      checkInDate,
      checkOutDate
    );

    if (!isAvailable) {
      return res.status(400).json({
        message: "Listing is already booked for the selected dates",
      });
    }

    // Fetch form
    const form = await Form.findOne({ subCategory: listing.subCategory, zone: listing.zone });
    if (!form) return res.status(400).json({ message: "Form not found for this listing" });

    // Check required documents (UNCHANGED)
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

    const checkInDay = checkInDate.toISOString().split("T")[0];
    const checkOutDay = checkOutDate.toISOString().split("T")[0];

    let priceBreakdown;

    if (checkInDay === checkOutDay) {
      const hours = Math.ceil(
        (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60)
      );

      let hourlyRate = 0;

      if (listing.priceUnit === "hour") {
        hourlyRate = listing.price;
      } else if (listing.priceUnit === "day") {
        hourlyRate = listing.price / 24;
      } else if (listing.priceUnit === "month") {
        hourlyRate = listing.price / (30 * 24);
      } else if (listing.priceUnit === "year") {
        hourlyRate = listing.price / (365 * 24);
      }

      const basePrice = hourlyRate * hours;

      const adminFee =
        basePrice *
        ((form.setting.renterCommission.value +
          form.setting.leaserCommission.value) /
          100);

      const tax = basePrice * (form.setting.tax / 100);

      const totalPrice = basePrice + adminFee + tax;

      priceBreakdown = {
        basePrice,
        adminFee,
        tax,
        totalPrice,
        duration: hours,
      };
    } else {
      priceBreakdown = calculateBookingPrice({
        basePrice: listing.price,
        unit: listing.priceUnit,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adminCommissionRate:
          (form.setting.renterCommission.value +
            form.setting.leaserCommission.value) /
          100,
        taxRate: form.setting.tax / 100,
      });
    }

    const priceDetails = {
      price: priceBreakdown.basePrice,
      adminFee: priceBreakdown.adminFee,
      tax: priceBreakdown.tax,
      totalPrice: priceBreakdown.totalPrice,
    };

    if (renter.wallet.balance < priceDetails.totalPrice) {
      return res.status(400).json({
        message:
          "Insufficient wallet balance to create booking. Please add funds.",
        requiredBalance: priceDetails.totalPrice,
        currentBalance: renter.wallet.balance,
      });
    }

    const newBooking = await Booking.create({
      ...bookingData,
      dates: { checkIn: checkInDate, checkOut: checkOutDate },
      renter: user.id,
      leaser: leaserId,
      status: "pending",
      marketplaceListingId: listingId,
      priceDetails,
      pricingMeta: {
        priceFromListing: listing.price,
        unit: listing.priceUnit,
        duration: priceBreakdown.duration,
      },
    });

    try {
      await sendNotification(
        leaserId.toString(),
        "New Booking Request",
        `Renter booked your listing "${listing.name}".`,
        {
          bookingId: newBooking._id.toString(),
          listingId: listing._id.toString(),
          type: "booking",
          status: "pending",
        }
      );
    } catch (err) {
      console.error("Failed to notify leaser about new booking:", err);
    }

    return res.status(201).json({
      message: "Booking created successfully",
      booking: newBooking,
      priceFromListing: {
        priceFromListing: listing.price,
        unit: listing.priceUnit,
        duration: priceBreakdown.duration,
      },
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

// updateBookingStatus
export const updateBookingStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status, additionalCharges, isExtendApproval } = req.body;
    const user = (req as any).user;
    const userId = user.id || user._id;

    let parentBooking = await Booking.findById(id)
      .populate("renter", "email name fcmToken wallet")
      .populate("leaser", "email name fcmToken wallet")
      .populate("marketplaceListingId");

    if (!parentBooking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Booking not found",
        STATUS_CODES.NOT_FOUND
      );
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

    const listingName =
      typeof parentBooking.marketplaceListingId === "object" &&
        "name" in parentBooking.marketplaceListingId
        ? (parentBooking.marketplaceListingId as any).name
        : "";

    // ========== EXTENSION APPROVAL LOGIC ==========
    if (isExtendApproval) {
      const childBooking = await Booking.findOne({
        previousBookingId: id,
        status: "pending",
      }).session(session);

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

      const renter = parentBooking.renter as any;
      const leaser = parentBooking.leaser as any;

      const extendChargeAmount = Number(additionalCharges) || 0;
      const extensionTotal =
        childBooking.priceDetails.totalPrice + extendChargeAmount;

      // Wallet check
      if (!renter?.wallet || renter.wallet.balance < extensionTotal) {
        await session.abortTransaction();
        session.endSession();

        try {
          await sendNotification(
            renterId,
            "Extension Approval Failed",
            `Your extension for "${listingName}" could not be approved due to insufficient wallet balance.`,
            {
              bookingId: childBooking._id.toString(),
              type: "extension",
              status: "payment_required",
              requiredBalance: extensionTotal,
              currentBalance: renter.wallet?.balance || 0,
            }
          );
        } catch (err) {
          console.error("Failed to notify renter about wallet issue:", err);
        }

        return sendResponse(
          res,
          {
            requiredBalance: extensionTotal,
            currentBalance: renter.wallet?.balance || 0,
          },
          "Insufficient wallet balance for extension approval",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // Deduct renter wallet & credit leaser
      renter.wallet.balance -= extensionTotal;
      await renter.save({ session });

      if (leaser?.wallet) {
        leaser.wallet.balance += extensionTotal;
        await leaser.save({ session });
      }

      // Update child booking
      childBooking.isExtend = true;
      childBooking.status = "approved";
      childBooking.extendCharges = {
        extendCharges: extendChargeAmount,
        totalPrice: extensionTotal,
      };
      (childBooking as any).extensionRequestedDate = undefined;
      await childBooking.save({ session });

      // Update parent booking
      parentBooking.isExtend = true;
      await parentBooking.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        await sendNotification(
          renterId,
          "Extension Approved",
          `Your extension request for "${listingName}" has been approved. Amount deducted from your wallet: ${extensionTotal}.`,
          {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            deductedAmount: extensionTotal, // ADDED
          }
        );

        // ADDED: LEASER NOTIFICATION (wallet credit)
        await sendNotification(
          leaserId,
          "Extension Payment Received",
          `You received ${extensionTotal} in your wallet for the extension of "${listingName}".`,
          {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            creditedAmount: extensionTotal, //ADDED
          }
        );

      } catch (err) {
        console.error("Failed to notify renter about extension approval:", err);
      }

      return sendResponse(
        res,
        childBooking,
        "Extension approved successfully",
        STATUS_CODES.OK
      );
    }

    // ========== STATUS VALIDATION ==========
    const allowedStatuses = ["approved", "rejected", "completed", "cancelled"];
    if (!allowedStatuses.includes(finalStatus)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Invalid status",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (finalStatus === "cancelled" && !isRenter) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Only renter can cancel the booking",
        STATUS_CODES.FORBIDDEN
      );
    }

    if (
      ["approved", "rejected", "completed"].includes(finalStatus) &&
      !isLeaser
    ) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Only leaser can change the booking status",
        STATUS_CODES.FORBIDDEN
      );
    }

    let updateFields: any = { status: finalStatus };
    let finalBooking: IBooking | null = null;
    let pin: string | undefined;

    // ========== APPROVED STATUS LOGIC ==========
    if (finalStatus === "approved") {
      const renter = parentBooking.renter as any;
      const leaser = parentBooking.leaser as any;

      // Force special charges if specialRequest exists
      const hasSpecialRequest =
        parentBooking.specialRequest && parentBooking.specialRequest.length > 0;
      let specialCharges = Number(additionalCharges) || 0;

      if (hasSpecialRequest && specialCharges <= 0) {
        return sendResponse(
          res,
          null,
          "Special request charges must be applied for this booking",
          STATUS_CODES.BAD_REQUEST
        );
      }

      const totalAmount =
        parentBooking.priceDetails.totalPrice + specialCharges;

      // Wallet existence check
      if (!renter?.wallet) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(
          res,
          null,
          "Renter wallet not found",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // Balance validation
      if (renter.wallet.balance < totalAmount) {
        await session.abortTransaction();
        session.endSession();

        try {
          await sendNotification(
            renterId,
            "Booking Approval Failed",
            `Your booking for "${listingName}" could not be approved due to insufficient wallet balance.`,
            {
              bookingId: parentBooking._id.toString(),
              type: "booking",
              status: "payment_required",
              requiredBalance: totalAmount,
              currentBalance: renter.wallet.balance,
            }
          );
        } catch (err) {
          console.error("Failed to notify renter about wallet issue:", err);
        }

        return sendResponse(
          res,
          {
            requiredBalance: totalAmount,
            currentBalance: renter.wallet.balance,
          },
          "Insufficient wallet balance. Booking cannot be approved.",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // Deduct renter wallet & credit leaser
      renter.wallet.balance -= totalAmount;
      await renter.save({ session });

      if (leaser?.wallet) {
        leaser.wallet.balance += totalAmount;
        await leaser.save({ session });
      }

      // Generate OTP PIN
      pin = generatePIN(4);
      updateFields.otp = pin;

      // Update price details and extra charges
      updateFields.priceDetails = {
        ...parentBooking.priceDetails,
        totalPrice: totalAmount,
      };

      updateFields.extraRequestCharges = {
        additionalCharges: specialCharges,
        totalPrice: totalAmount,
      };
    }

    if (finalStatus === "completed") {
      updateFields["bookingDates.returnDate"] = new Date();
    }

    // ========== UPDATE BOOKING ==========
    finalBooking = await Booking.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    )
      .populate("renter", "email name fcmToken")
      .populate("leaser", "email name fcmToken");

    if (!finalBooking) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Booking update failed",
        STATUS_CODES.INTERNAL_SERVER_ERROR
      );
    }

    // ========== UPDATE LISTING ==========
    const listing = await MarketplaceListing.findById(
      finalBooking.marketplaceListingId
    );

    if (listing) {
      if (finalStatus === "approved") {
        listing.isAvailable = false;
        listing.currentBookingId = [
          ...(listing.currentBookingId || []).filter(
            (item) => item.toString() !== bookingIdString
          ),
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

    // ========== NOTIFICATIONS ==========
    try {
      const renter = finalBooking.renter as any;
      const leaser = finalBooking.leaser as any;

      const renterId =
        typeof renter === "object"
          ? renter._id?.toString()
          : renter?.toString();
      const leaserId =
        typeof leaser === "object"
          ? leaser._id?.toString()
          : leaser?.toString();
      const listingId = listing?._id?.toString() || "";

      if (finalStatus === "approved") {
        const totalPaid = finalBooking.priceDetails.totalPrice;
        await sendEmail({
          to: leaser.email,
          name: leaser.name,
          subject: "Booking Approved - PIN Code",
          content: `
      <h2>Booking Approved</h2>
      <p>Your listing "<strong>${listingName}</strong>" has been booked and approved.</p>
      <p><strong>PIN Code:</strong> ${pin}</p>
      <p>Please keep this PIN safe. The renter will provide this PIN at the check-in date/time for verification.</p>
    `,
        });

        await sendNotification(
          leaserId,
          "Booking Approved - PIN Code",
          `The booking for "${listingName}" is approved. PIN Code: ${pin}. Amount deducted from User's wallet: ${totalPaid}.`,
          {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: finalStatus,
            deductedAmount: totalPaid,
          }
        );
        await sendNotification(
          leaser._id.toString(),
          "Payment Received",
          `You received ${totalPaid} in your wallet for the booking of "${listingName}".`,
          {
            bookingId: finalBooking._id.toString(),
            type: "booking",
            status: "approved",
            creditedAmount: totalPaid,
          }
        );
      }

      let renterMsg = `Your booking ${finalBooking._id?.toString()} status changed to ${finalStatus}.`;

      if (finalStatus === "approved") {
        const totalPaid = finalBooking.priceDetails.totalPrice;
        renterMsg = `Your booking for "${listingName}" has been approved. 
        Amount deducted from your wallet: ${totalPaid}. 
        The PIN has been sent to the leaser. Please provide the PIN at check-in.`;
      } else if (finalStatus === "rejected") {
        renterMsg = `Your booking for "${listingName}" has been rejected.`;
      } else if (finalStatus === "completed") {
        renterMsg = `The booking for "${listingName}" has been completed.`;
      } else if (finalStatus === "cancelled") {
        renterMsg = `Your booking for "${listingName}" has been cancelled.`;
      }

      await sendNotification(renterId, `Booking ${finalStatus}`, renterMsg, {
        bookingId: finalBooking._id?.toString(),
        listingId,
        type: "booking",
        status: finalStatus,
      });
    } catch (err) {
      console.error("Failed to notify users about booking status change:", err);
    }

    return sendResponse(
      res,
      finalBooking,
      `Booking status updated to ${finalStatus}`,
      STATUS_CODES.OK
    );


  } catch (err) {
    await session.abortTransaction();
    session.endSession();
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

    const baseQuery = Booking.find(filter)
      .populate({
        path: "marketplaceListingId",
        populate: {
          path: "leaser",
          select: "name",
        },
      })
      .populate({
        path: "leaser",
        select: "name",
      });

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

    const allBookings = await Booking.find(filter)
      .populate({
        path: "leaser",
        select: "name",
      })
      .lean();

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

//helper function to fetch payment status by bookingId
const attachPaymentStatus = async (booking: any) => {
  const payment = await Payment.findOne({ bookingId: booking._id }).lean();
  return {
    ...booking,
    paymentStatus: payment?.status ?? null,
  };
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

    let booking = await Booking.findById(id)
      // .populate("marketplaceListingId")
      .populate({
        path: "marketplaceListingId",
        populate: [
          {
            path: "leaser",
            select: "name email profilePicture",
          },
          {
            path: "zone",
            select: "name",
          },
        ],
      })
      .populate("renter")
      .lean();

    if (!booking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    booking = await attachPaymentStatus(booking);

    const childBookings = await Booking.find({ previousBookingId: id }).lean();

    const extensions = await Promise.all(
      childBookings.map(async (child: any, idx: number) => {
        const childWithPayment = await attachPaymentStatus(child);
        return {
          _id: childWithPayment._id?.toString?.() ?? childWithPayment._id,
          name: `Extension ${idx + 1}`,
          extensionDate: childWithPayment.dates?.checkOut ?? null,
          handover: childWithPayment.bookingDates?.handover ?? null,
          returnDate: childWithPayment.bookingDates?.returnDate ?? null,
          priceDetails: childWithPayment.priceDetails ?? null,
          pricingMeta: childWithPayment.pricingMeta ?? null,
          extraRequestCharges: childWithPayment.extraRequestCharges ?? null,
          paymentStatus: childWithPayment.paymentStatus ?? null,
        };
      })
    );

    const result = {
      ...booking,
      extensions,
    };
    const reviews = await Review.find({ bookingId: id })
      .populate("userId", "name email")
      .lean();

    const formattedReviews = reviews.map((r) => ({
      user: r.userId,
      review: {
        stars: r.stars,
        comment: r.comment,
        createdAt: r.createdAt,
      },
    }));

    const finalResult = {
      ...result,
      reviews: formattedReviews,
    };

    sendResponse(
      res,
      finalResult,
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

    const filter: any = {};

    if (role === "renter") {
      filter.renter = user.id;
    } else if (role === "leaser") {
      filter.leaser = user.id;
    } else {
      filter.$or = [{ renter: user.id }, { leaser: user.id }];
    }

    if (status) filter.status = status;

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

    const bookingsMap: Record<string, any> = {};

    filteredBookings.forEach((booking) => {
      bookingsMap[booking._id.toString()] = { ...booking, extensions: [] };
    });

    await Promise.all(
      Object.values(bookingsMap).map(async (parent: any) => {
        const parentWithPayment = await attachPaymentStatus(parent);
        Object.assign(parent, parentWithPayment);
      })
    );

    await Promise.all(
      filteredBookings.map(async (booking) => {
        if (booking.previousBookingId) {
          const parentIdStr = booking.previousBookingId.toString();
          const parent = bookingsMap[parentIdStr];
          if (parent) {
            const extensionCount = parent.extensions.length + 1;
            const childWithPayment = await attachPaymentStatus(booking);

            parent.extensions.push({
              _id: childWithPayment._id?.toString?.() ?? childWithPayment._id,
              name: `Extension ${extensionCount}`,
              extensionDate: childWithPayment.dates?.checkOut ?? null,
              handover: childWithPayment.bookingDates?.handover ?? null,
              returnDate: childWithPayment.bookingDates?.returnDate ?? null,
              priceDetails: childWithPayment.priceDetails ?? null,
              pricingMeta: childWithPayment.pricingMeta ?? null,
              extraRequestCharges: childWithPayment.extraRequestCharges ?? null,
              paymentStatus: childWithPayment.paymentStatus ?? null,
            });

            delete bookingsMap[booking._id.toString()];
          }
        }
      })
    );

    const mergedBookings = Object.values(bookingsMap);

    const total = mergedBookings.length;
    const paginatedBookings = mergedBookings.slice(
      (page - 1) * limit,
      page * limit
    );

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
    console.log("hello");
    const { id } = req.params;
    const user = (req as any).user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

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

    Object.assign(booking, req.body);

    const updatedBooking = await booking.save();

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

// SUBMIT BOOKING PIN
export const submitBookingPin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp)
      return sendResponse(
        res,
        null,
        "PIN is required",
        STATUS_CODES.BAD_REQUEST
      );

    if (!mongoose.Types.ObjectId.isValid(id))
      return sendResponse(
        res,
        null,
        "Invalid booking ID",
        STATUS_CODES.BAD_REQUEST
      );

    const booking = await Booking.findById(id)
      .populate("renter", "email name fcmToken")
      .populate("leaser", "email name fcmToken");

    if (!booking)
      return sendResponse(
        res,
        null,
        "Booking not found",
        STATUS_CODES.NOT_FOUND
      );

    if (booking.otp !== otp)
      return sendResponse(
        res,
        null,
        "Invalid or expired PIN",
        STATUS_CODES.UNAUTHORIZED
      );

    const now = new Date();
    const checkIn = new Date(booking.dates.checkIn);
    const checkOut = new Date(booking.dates.checkOut);

    const isSameDay =
      checkIn.toISOString().split("T")[0] ===
      checkOut.toISOString().split("T")[0];

    if (isSameDay) {
      if (now < checkIn) {
        return sendResponse(
          res,
          null,
          "PIN submission not allowed before the check-in time.",
          STATUS_CODES.BAD_REQUEST
        );
      }

      if (now > checkOut) {
        return sendResponse(
          res,
          null,
          "PIN has expired because check-out time has passed.",
          STATUS_CODES.BAD_REQUEST
        );
      }
    } else {
      if (now < checkIn)
        return sendResponse(
          res,
          null,
          "PIN submission not allowed before check-in date.",
          STATUS_CODES.BAD_REQUEST
        );

      if (now > checkOut)
        return sendResponse(
          res,
          null,
          "PIN has expired after checkout date.",
          STATUS_CODES.BAD_REQUEST
        );
    }

    const isRunning = now >= checkIn && now <= checkOut;

    if (booking.status === "approved" && isRunning) {
      if (!booking.bookingDates) booking.bookingDates = {};
      if (!booking.bookingDates.handover) booking.bookingDates.handover = now;

      booking.otp = "";
      booking.isVerified = true;
      booking.status = "in_progress";

      await booking.save();

      try {
        const listing = (await MarketplaceListing.findById(
          booking.marketplaceListingId
        )) as IMarketplaceListing | null;

        if (listing) {
          const renter = booking.renter as IUser | null;
          const leaser = booking.leaser as IUser | null;

          if (renter?._id) {
            await sendNotification(
              renter._id.toString(),
              "Booking Started",
              `Your booking for "${listing.name}" has officially started.`,
              {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
                type: "booking_started",
              }
            );
          }

          if (leaser?._id) {
            await sendNotification(
              leaser._id.toString(),
              "Booking Started",
              `${renter?.name} has entered the PIN and the booking has begun for "${listing.name}".`,
              {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
                type: "booking_started",
              }
            );
          }
        }
      } catch (err) {
        console.error("Failed to notify leaser on booking start:", err);
      }

      return sendResponse(
        res,
        booking,
        "PIN verified successfully and handover recorded",
        STATUS_CODES.OK
      );
    }

    const newBookingData: any = {
      status: "in_progress",
      renter: booking.renter,
      leaser: booking.leaser,
      marketplaceListingId: booking.marketplaceListingId,
      dates: booking.dates,
      language: booking.language,
      otp: "",
      isVerified: true,
      priceDetails: booking.priceDetails,
      extraRequestCharges: booking.extraRequestCharges,
      specialRequest: booking.specialRequest,
      isExtend: false,
      extensionRequestedDate: undefined,
      bookingDates: { handover: now, returnDate: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const existingActive = await Booking.findOne({
      renter: booking.renter,
      marketplaceListingId: booking.marketplaceListingId,
      "bookingDates.returnDate": { $in: [null, undefined] },
      _id: { $ne: booking._id },
      status: "in_progress",
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
    booking.isVerified = true;
    await booking.save();

    try {
      const listing = (await MarketplaceListing.findById(
        createdNewBooking.marketplaceListingId
      )) as IMarketplaceListing | null;

      if (listing) {
        const renter = createdNewBooking.renter as IUser | null;
        const leaser = createdNewBooking.leaser as IUser | null;

        if (renter?._id) {
          await sendNotification(
            renter._id.toString(),
            "Booking Started",
            `Your booking for "${listing.name}" has officially started.`,
            {
              bookingId: createdNewBooking._id.toString(),
              listingId: listing._id.toString(),
              type: "booking_started",
            }
          );
        }

        if (leaser?._id) {
          await sendNotification(
            leaser._id.toString(),
            "Booking Started",
            `${renter?.name} has entered the PIN and the new booking has begun for "${listing.name}".`,
            {
              bookingId: createdNewBooking._id.toString(),
              listingId: listing._id.toString(),
              type: "booking_started",
            }
          );
        }
      }
    } catch (err) {
      console.error("Failed to notify leaser on new booking start:", err);
    }

    return sendResponse(
      res,
      createdNewBooking,
      "New running booking created and handover recorded",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};
