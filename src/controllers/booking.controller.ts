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
  PriceUnit,
} from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Types } from "mongoose";
import { Form } from "../models/form.model";
import { generatePIN } from "../utils/generatePin";
import { Review } from "../models/review.model";
import { isBookingDateAvailable, isBookingExpiredForApproval } from "../utils/dateValidator";
import { notificationQueue } from "../queues/notification.queue";
import { emailQueue } from "../queues/email.queue";
import { cancelReminder, scheduleReminder } from "../queues/reminders";
import { REMINDER } from "../config/reminderTypes";
import { calculateBookingPrice } from "../utils/calculateBookingPrice";
import { Payment } from "../models/payment.model";
import { DamageReport } from "../models/damageReport.model";
import { Zone } from "../models/zone.model";
import { IRentalDuration, RentalPolicy } from "../models/rentalPolicy.model";
import { checkAndUpdateBookingExpiry } from "../utils/bookingExpiry";
import {
  captureHeldBookingPayment,
  createManualBookingPaymentIntent,
  markBookingEarningAvailable,
  refundBookingPaymentAmount,
  releaseBookingPaymentHold,
} from "../utils/bookingStripePayments";

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
    const { marketplaceListingId, dates, extensionDate, ...bookingData } = req.body;

    const renter = await User.findById(user.id);
    if (!renter) {
      return res.status(404).json({ message: "Renter not found" });
    }

    if (renter.status === "inactive" || renter.status === "blocked") {
      return res.status(403).json({
        message: `Your account is ${renter.status}. You cannot create a booking.`
      });
    }

    if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
      return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
    }

    const listing = await MarketplaceListing.findById(marketplaceListingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    const listingId = listing._id as Types.ObjectId;
    const leaserId = listing.leaser as Types.ObjectId;

    // 1. MOVED UP: Fetch Form first so we have Tax/Commission rates for both Extensions and New Bookings
    const form = await Form.findOne({ subCategory: listing.subCategory, zone: listing.zone });
    if (!form) return res.status(400).json({ message: "Form settings not found for this listing" });

    // Prepare rates
    const adminCommissionRate = (form.setting.renterCommission.value + form.setting.leaserCommission.value) / 100;
    const taxRate = form.setting.tax / 100;

    // --- SECURITY DEPOSIT + RENTAL POLICY FETCH ---
    const zone = await Zone.findById(listing.zone);
    if (!zone) return res.status(404).json({ message: "Zone not found for this listing" });

    const rentalPolicy = await RentalPolicy.findOne({
      zone: listing.zone,
      subCategory: listing.subCategory,
    });

    if (!rentalPolicy) {
      return res.status(400).json({
        message: "Rental policy is not configured for this zone and subcategory",
      });
    }

    // Determine security deposit amount (0 if policy missing or deposit not required)
    const securityDepositAmount =
      rentalPolicy?.securityDepositRules?.depositRequired
        ? rentalPolicy.securityDepositRules.depositAmount
        : 0;
    const depositDisputeWindowDays =
      rentalPolicy?.securityDepositRules?.disputeWindowDays ?? 7;
    const rentalPolicySnapshot = {
      securityDepositRules: rentalPolicy.securityDepositRules,
      damageLiabilityTerms: rentalPolicy.damageLiabilityTerms,
      rentalDurationLimits: rentalPolicy.rentalDurationLimits,
      extensionAllowed: rentalPolicy.extensionAllowed,
    };

    // --- RENTAL DURATION LIMITS HELPER ---
    // Converts any IRentalDuration to hours for uniform comparison
    const toHours = (duration: IRentalDuration): number => {
      switch (duration.unit) {
        case "hour": return duration.value;
        case "day": return duration.value * 24;
        case "month": return duration.value * 24 * 30;
        case "year": return duration.value * 24 * 365;
        default: return duration.value;
      }
    };

    const getDurationHours = (
      checkIn: Date,
      checkOut: Date,
      priceUnit: PriceUnit
    ): number => {
      const diffMs = checkOut.getTime() - checkIn.getTime();

      if (priceUnit === "day") {
        return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) * 24;
      }

      return diffMs / (1000 * 60 * 60);
    };

    // Validates checkIn→checkOut against the policy's rentalDurationLimits for a given priceUnit
    // Returns null if valid, or an error message string if invalid
    const validateRentalDuration = (
      checkIn: Date,
      checkOut: Date,
      priceUnit: PriceUnit
    ): string | null => {
      if (!rentalPolicy?.rentalDurationLimits?.length) return null; // No limits set — allow all

      const limitRule = rentalPolicy.rentalDurationLimits.find(
        (l) => l.appliesToPriceUnit === priceUnit
      );
      if (!limitRule) return null;

      const diffHours = getDurationHours(checkIn, checkOut, priceUnit);

      const minHours = toHours(limitRule.minimumDuration);
      const maxHours = toHours(limitRule.maximumDuration);

      if (diffHours < minHours) {
        return `Minimum rental duration for this listing is ${limitRule.minimumDuration.value} ${limitRule.minimumDuration.unit}(s)`;
      }
      if (diffHours > maxHours) {
        return `Maximum rental duration for this listing is ${limitRule.maximumDuration.value} ${limitRule.maximumDuration.unit}(s)`;
      }

      return null; // Valid
    };

    /* ---------------------------------------------------------
             EXTENSION LOGIC
          --------------------------------------------------------- */
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
        return res.status(400).json({ message: "You have an active booking for this listing. Please provide an extension date to extend your rental period." });
      }

      const lastExtension = await Booking.findOne({
        previousBookingId: existingActiveBooking._id,
      }).populate("previousBookingId").sort({ createdAt: -1 });

      if (lastExtension && lastExtension.status !== "approved") {
        return res.status(400).json({
          message: "Your previous extension request must be approved before submitting a new one.",
        });
      }

      // --- EXTENSION ALLOWED CHECK ---
      const allExtensions = await Booking.find({
        previousBookingId: existingActiveBooking._id,
      }).sort({ "dates.checkOut": -1 }).limit(1);

      const allExtensionIds = await Booking.find({
        previousBookingId: existingActiveBooking._id,
      }).distinct("_id");

      const excludeIds = [existingActiveBooking._id, ...allExtensionIds];

      const latestCheckOut = allExtensions.length > 0
        ? allExtensions[0].dates.checkOut
        : existingActiveBooking.dates.checkOut;

      const extensionStartDate = new Date(latestCheckOut);

      // For hourly: extensionDate comes as full ISO with local offset — parse as-is
      // For date-only (day/month/year): set to end of day so full day is included
      let extensionEndDate: Date;
      if (isDateOnly(extensionDate)) {
        extensionEndDate = new Date(extensionDate);
        extensionEndDate.setUTCHours(23, 59, 59, 999);
      } else {
        extensionEndDate = new Date(extensionDate); // hourly — full ISO, no adjustment
      }

      // For hourly: allow extension from same checkout time onwards (minimum 1 hour after)
      // For other units: end date must simply be after start date
      const isHourlyUnit = listing.priceUnit === "hour";

      if (isHourlyUnit) {
        const minAllowedEnd = new Date(extensionStartDate.getTime() + 60 * 60 * 1000); // +1 hour
        if (extensionEndDate < minAllowedEnd) {
          return res.status(400).json({
            message: "Hourly extension must be at least 1 hour after current checkout.",
          });
        }
      } else {
        if (extensionEndDate <= extensionStartDate) {
          return res.status(400).json({
            message: "Extension date must be after previous checkout date.",
          });
        }
      }

      // --- RENTAL DURATION LIMITS CHECK (EXTENSION) ---
      const extensionDurationError = validateRentalDuration(
        extensionStartDate,
        extensionEndDate,
        listing.priceUnit as PriceUnit
      );
      if (extensionDurationError) {
        return res.status(400).json({ message: extensionDurationError });
      }

      const isAvailableForExtend = await isBookingDateAvailable(
        listingId,
        extensionStartDate,
        extensionEndDate,
        excludeIds
      );

      if (!isAvailableForExtend) {
        return res.status(400).json({
          message: "Listing is not available for the selected extension period",
        });
      }

      // =========================================================================
      // FIXED FOR EXTENSIONS: Align lookup progression with advanced frontend indexing
      // =========================================================================
      let priceBreakdown;
      if (!isHourlyUnit) {
        // Clone timestamps so we do not mutate parameters used to save the model
        const calculationStart = new Date(extensionStartDate);
        const calculationEnd = new Date(extensionEndDate);

        // Shift progression offset boundaries forward by exactly 1 calendar step to
        // mirror how the UI loop pre-advances dates prior to checking dynamic keys
        if (listing.priceUnit === "day") {
          calculationStart.setUTCDate(calculationStart.getUTCDate() + 1);
          calculationEnd.setUTCDate(calculationEnd.getUTCDate() + 1);
        } else if (listing.priceUnit === "month") {
          calculationStart.setUTCMonth(calculationStart.getUTCMonth() + 1);
          calculationEnd.setUTCMonth(calculationEnd.getUTCMonth() + 1);
        } else if (listing.priceUnit === "year") {
          calculationStart.setUTCFullYear(calculationStart.getUTCFullYear() + 1);
          calculationEnd.setUTCFullYear(calculationEnd.getUTCFullYear() + 1);
        }

        priceBreakdown = calculateBookingPrice({
          basePrice: listing.price,
          unit: listing.priceUnit,
          checkIn: calculationStart,
          checkOut: calculationEnd,
          adminCommissionRate,
          taxRate,
          dynamicPricing: listing?.dynamicPricing,
        });
      } else {
        // Hourly execution paths track standard linear millisecond updates cleanly
        priceBreakdown = calculateBookingPrice({
          basePrice: listing.price,
          unit: listing.priceUnit,
          checkIn: extensionStartDate,
          checkOut: extensionEndDate,
          adminCommissionRate,
          taxRate,
          dynamicPricing: listing?.dynamicPricing,
        });
      }
      // =========================================================================

      const priceDetails = {
        price: priceBreakdown.basePrice,
        adminFee: 0,
        tax: 0,
        securityDeposit: 0,
        totalPrice: priceBreakdown.basePrice,
      };

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
          unit: listing.priceUnit,
          duration: priceBreakdown.duration,
        },
        isExtend: false,
        previousBookingId: existingActiveBooking._id,
        extensionRequestedDate: extensionEndDate,
        rentalPolicyId: rentalPolicy?._id,
        rentalPolicySnapshot,
      });

      const paymentIntent = await createManualBookingPaymentIntent(extendedBooking);

      return res.status(201).json({
        message: "Extension request created successfully",
        booking: extendedBooking,
        priceBreakdown,
        payment: {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
        },
      });
    }

    /* ---------------------------------------------------------
       NEW BOOKING LOGIC
    --------------------------------------------------------- */
    if (!dates?.checkIn || !dates?.checkOut) {
      return res.status(400).json({ message: "Booking dates (checkIn & checkOut) are required" });
    }

    const { checkIn: checkInDate, checkOut: checkOutDate } = normalizeBookingDates(dates.checkIn, dates.checkOut);

    // --- RENTAL DURATION LIMITS CHECK (NEW BOOKING) ---
    // Must run before availability check — no point querying DB if dates are out of policy
    const durationError = validateRentalDuration(
      checkInDate,
      checkOutDate,
      listing.priceUnit as PriceUnit
    );
    if (durationError) {
      return res.status(400).json({ message: durationError });
    }

    let availabilityCheckIn = checkInDate;
    if (listing.priceUnit === "hour") {
      availabilityCheckIn = new Date(checkInDate.getTime() + 1);
    }

    const isAvailable = await isBookingDateAvailable(
      listingId,
      availabilityCheckIn,
      checkOutDate
    );

    if (!isAvailable) {
      return res.status(400).json({ message: "Listing is already booked for the selected dates" });
    }

    // Check required documents
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

      if (missingDocs.length > 0) return res.status(400).json({ message: `Missing docs: ${missingDocs.join(", ")}` });
      if (unapprovedDocs.length > 0) return res.status(400).json({ message: `Unapproved docs: ${unapprovedDocs.join(", ")}` });
    }

    // 2. FIX: Unified Calculation Logic
    const priceBreakdown = calculateBookingPrice({
      basePrice: listing.price,
      unit: listing.priceUnit,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      adminCommissionRate,
      taxRate,
      dynamicPricing: listing.dynamicPricing
    });

    const priceDetails = {
      price: priceBreakdown.basePrice,
      adminFee: priceBreakdown.adminFee,
      tax: priceBreakdown.tax,
      // Include security deposit from zone's rental policy (0 if not required)
      securityDeposit: securityDepositAmount,
      // Total = booking price + security deposit
      totalPrice: priceBreakdown.totalPrice,
    };

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
      rentalPolicyId: rentalPolicy?._id, // Store which policy was active at time of booking
      rentalPolicySnapshot,
      depositStatus: securityDepositAmount > 0 ? "held" : "none",
      depositDisputeWindowDays,
    });

    const paymentIntent = await createManualBookingPaymentIntent(newBooking);

    // Nudge the renter before the pending booking expires.
    // Cancelled once the payment hold lands (payment.controller).
    if (zone.bookingExpiryEnabled) {
      const expiryMinutes = zone.expiryTimeMinutes ?? 15;
      const expiresAt = new Date(
        new Date((newBooking as any).createdAt).getTime() + expiryMinutes * 60_000
      );

      await scheduleReminder({
        type: REMINDER.BOOKING_PAYMENT_PENDING,
        entityId: newBooking._id.toString(),
        userId: user.id,
        targetDate: expiresAt,
        title: "Complete Your Payment",
        message: `Your booking for "${listing.name}" is still awaiting payment and will expire soon.`,
        data: {
          bookingId: newBooking._id.toString(),
          listingId: listingId?.toString(),
        },
      });
    }

    return res.status(201).json({
      message: "Booking created successfully",
      booking: newBooking,
      priceBreakdown,
      // Return deposit info so frontend can show the renter what was held
      securityDeposit: {
        amount: securityDepositAmount,
        required: securityDepositAmount > 0,
        conditions: rentalPolicy?.securityDepositRules?.depositConditions ?? "",
        disputeWindowDays: depositDisputeWindowDays,
      },
      payment: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
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
    const { status, additionalCharges, isExtendApproval, childBookingId } = req.body;
    const user = (req as any).user;
    const userId = user.id || user._id;

    const admin = await User.findOne({ role: "admin" });

    if (!admin) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Admin not found",
        STATUS_CODES.NOT_FOUND
      );
    }

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
      if (status === "rejected") {
        if (!isLeaser) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(res, null, "Only leaser can reject the extension", STATUS_CODES.FORBIDDEN);
        }

        const childBooking = childBookingId
          ? await Booking.findOne({ _id: childBookingId, previousBookingId: id, status: "pending" }).session(session)
          : await Booking.findOne({ previousBookingId: id, status: "pending" }).sort({ createdAt: -1 }).session(session);

        if (!childBooking) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(res, null, "No pending extension found", STATUS_CODES.BAD_REQUEST);
        }

        await releaseBookingPaymentHold(childBooking._id, session);
        childBooking.status = "rejected";
        await childBooking.save({ session });

        await session.commitTransaction();
        session.endSession();

        try {
          await notificationQueue.add("extension-rejected", {
            userId: renterId,
            title: "Extension Rejected",
            message: `Your extension request for "${listingName}" has been rejected.`,
            data: {
              bookingId: childBooking._id.toString(),
              type: "extension",
              status: "rejected",
            },
          });

          await notificationQueue.add("extension-rejected", {
            userId: leaserId,
            title: "Extension Rejected",
            message: `You have rejected the extension request for "${listingName}".`,
            data: {
              bookingId: childBooking._id.toString(),
              type: "extension",
              status: "rejected",
            },
          });
        } catch (err) {
          console.error("Failed to notify renter about extension rejection:", err);
        }

        return sendResponse(res, childBooking, "Extension rejected successfully", STATUS_CODES.OK);
      }

      const childBooking = childBookingId
        ? await Booking.findOne({ _id: childBookingId, previousBookingId: id, status: "pending" }).session(session)
        : await Booking.findOne({ previousBookingId: id, status: "pending" }).sort({ createdAt: -1 }).session(session);

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

      const { price, adminFee, tax } = childBooking.priceDetails;
      const extendChargeAmount = Number(additionalCharges) || 0;

      const renterPay = price + adminFee + tax + extendChargeAmount;
      const leaserReceive = price + extendChargeAmount;
      const adminReceive = adminFee + tax;

      if (extendChargeAmount > 0) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(
          res,
          null,
          "Additional extension charges require a separate Stripe payment before approval",
          STATUS_CODES.BAD_REQUEST
        );
      }

      await captureHeldBookingPayment(childBooking._id, session);

      // Generate OTP PIN for extension
      // const pin = generatePIN(4);


      // Update child booking
      childBooking.isExtend = true;
      childBooking.status = "approved";
      // childBooking.otp = pin;
      childBooking.extendCharges = {
        extendCharges: extendChargeAmount,
        totalPrice: renterPay,
      };
      (childBooking as any).extensionRequestedDate = undefined;
      await childBooking.save({ session });

      // Update parent booking
      parentBooking.isExtend = true;
      await parentBooking.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        //       await sendEmail({
        //         to: leaser.email,
        //         name: leaser.name,
        //         subject: "Extension Approved - PIN Code",
        //         content: `
        //   <h2>Extension Approved</h2>
        //   <p>The extension request for "<strong>${listingName}</strong>" has been approved.</p>
        //   <p><strong>PIN Code:</strong> ${pin}</p>
        //   <p>Please use this PIN to verify the extension at handover.</p>
        // `,
        //       });

        await notificationQueue.add("extension-approved", {
          userId: renterId,
          title: "Extension Approved",
          message: `Your extension request for "${listingName}" has been approved. Stripe payment captured: $${renterPay.toFixed(2)}.`,
          data: {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            deductedAmount: renterPay, // ADDED
          },
        });

        await notificationQueue.add("extension-approved", {
          userId: leaserId,
          title: "Extension Approved",
          message: `The extension for "${listingName}" has been approved.`,
          data: {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
          },
        });

        await notificationQueue.add("extension-payment-captured", {
          userId: admin._id as string,
          title: "Extension Payment Captured",
          message: `Extension payment of $${renterPay.toFixed(2)} was captured on the platform for "${listingName}".`,
          data: {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            creditedAmount: renterPay,
          },
        });
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
    const allowedStatuses = ["approved", "rejected", "completed", "request_cancelled", "booking_cancelled"];
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

    if (finalStatus === "request_cancelled" && !isRenter) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Only renter can cancel the booking",
        STATUS_CODES.FORBIDDEN
      );
    }

    // A booking can only be closed once the leaser has verified the return PIN
    if (
      finalStatus === "completed" &&
      parentBooking.status === "in_progress" &&
      !parentBooking.returnVerifiedAt
    ) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Return PIN must be verified before completing the booking",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (finalStatus === "booking_cancelled" && parentBooking.status !== "approved") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(
        res,
        null,
        "Booking can only be booking_cancelled when it is in approved status",
        STATUS_CODES.BAD_REQUEST
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
      const listing = parentBooking.marketplaceListingId as any;
      const isExpired = isBookingExpiredForApproval(
        parentBooking,
        listing.priceUnit
      );

      if (isExpired) {
        await session.abortTransaction();
        session.endSession();

        return sendResponse(
          res,
          null,
          "Cannot approve booking. Checkout date has already passed.",
          STATUS_CODES.BAD_REQUEST
        );
      }


      const renter = parentBooking.renter as any;
      const leaser = parentBooking.leaser as any;

      // Force special charges if specialRequest exists
      const hasSpecialRequest =
        parentBooking.specialRequest && parentBooking.specialRequest.length > 0;
      let specialCharges = Number(additionalCharges) || 0;

      const { price, adminFee, tax, securityDeposit } = parentBooking.priceDetails;

      const depositAmount = securityDeposit || 0;

      const renterPay = price + adminFee + tax + specialCharges;

      if (specialCharges > 0) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(
          res,
          null,
          "Special request charges require a separate Stripe payment before approval",
          STATUS_CODES.BAD_REQUEST
        );
      }

      await captureHeldBookingPayment(parentBooking._id, session);

      // Generate OTP PIN
      pin = generatePIN(4);
      updateFields.otp = pin;

      // Update price details and extra charges
      updateFields.priceDetails = {
        ...parentBooking.priceDetails,
        securityDeposit: depositAmount, // Preserve deposit amount on the record
        totalPrice: renterPay,          // totalPrice = booking cost (excl. deposit, consistent with creation)
      };

      updateFields.extraRequestCharges = {
        additionalCharges: specialCharges,
        totalPrice: renterPay,
      };
    }

    // AFTER
    if (finalStatus === "completed") {
      const completedAt = new Date();
      updateFields["bookingDates.returnDate"] = completedAt;
      updateFields["_depositRefunded"] = 0;
      const shouldReleaseLeaserEarning = parentBooking.status !== "completed";

      if (shouldReleaseLeaserEarning) {
        await markBookingEarningAvailable(parentBooking._id, session);

        const childBookings = await Booking.find({
          previousBookingId: parentBooking._id,
          status: { $in: ["approved", "in_progress", "completed"] },
        }).session(session);

        for (const childBooking of childBookings) {
          await markBookingEarningAvailable(childBooking._id, session);
        }
      }
      // ✅ Refund security deposit back to renter ONLY if no damage report
      const depositAmount = parentBooking.priceDetails?.securityDeposit || 0;

      const disputeWindowDays = parentBooking.depositDisputeWindowDays ?? 7;

      updateFields.depositDisputeWindowDays = disputeWindowDays;
      updateFields.disputeWindowEndsAt = new Date(
        completedAt.getTime() + disputeWindowDays * 24 * 60 * 60 * 1000
      );
      updateFields.depositStatus = depositAmount > 0 ? "held" : "none";
    }

    if (["rejected", "request_cancelled"].includes(finalStatus)) {
      await releaseBookingPaymentHold(parentBooking._id, session);
      updateFields.depositStatus = "none";
    }

    // ========== UPDATE BOOKING ==========
    finalBooking = await Booking.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, session }
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

      const specialCharges = finalBooking.extraRequestCharges?.additionalCharges || 0;

      const totalPaid = finalBooking.priceDetails.totalPrice;
      const leaserReceive = finalBooking.priceDetails.price + specialCharges;
      const adminReceive = finalBooking.priceDetails.adminFee + finalBooking.priceDetails.tax;

      const depositAmount = finalBooking.priceDetails.securityDeposit || 0;
      const totalRenterDeducted = totalPaid + depositAmount;


      if (finalStatus === "approved") {
        await emailQueue.add("booking-approved-pin", {
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

        await notificationQueue.add("booking-approved", {
          userId: leaserId,
          title: "Booking Approved - PIN Code",
          message: `The booking for "${listingName}" is approved. PIN Code: ${pin}.`,
          data: {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: finalStatus,
            deductedAmount: totalRenterDeducted.toFixed(2),
          },
        });

        await notificationQueue.add("booking-fee-received", {
          userId: admin._id as string,
          title: "Booking Fee Received",
          message: `Admin fee/tax of $${adminReceive.toFixed(2)} was captured for the booking of "${listingName}".`,
          data: {
            bookingId: finalBooking._id.toString(),
            type: "booking",
            status: "approved",
            creditedAmount: adminReceive.toFixed(2),
          },
        });
        if (depositAmount > 0) {
          await notificationQueue.add("security-deposit-received", {
            userId: admin._id as string,
            title: "Security Deposit Received",
            message: `A security deposit of $${depositAmount.toFixed(2)} has been held in escrow for the booking of "${listingName}". It will be released after the damage dispute window if no dispute is submitted.`,
            data: {
              bookingId: finalBooking._id.toString(),
              type: "booking",
              status: "approved",
              depositAmount,
            },
          });
        }

        // Both are cancelled in submitBookingPin once the renter collects the item
        await scheduleReminder({
          type: REMINDER.BOOKING_START,
          entityId: finalBooking._id.toString(),
          userId: renterId,
          targetDate: finalBooking.dates.checkIn,
          title: "Booking Starting Soon",
          message: `Your booking for "${listingName}" starts soon. Make sure you are ready to collect the item.`,
          data: {
            bookingId: finalBooking._id.toString(),
            listingId,
          },
        });

        await scheduleReminder({
          type: REMINDER.BOOKING_PICKUP,
          entityId: finalBooking._id.toString(),
          userId: renterId,
          targetDate: finalBooking.dates.checkIn,
          title: "Pickup Reminder",
          message: `Your pickup for "${listingName}" is coming up. Remember to collect the item and share the PIN with the leaser.`,
          data: {
            bookingId: finalBooking._id.toString(),
            listingId,
          },
        });

        await scheduleReminder({
          type: REMINDER.BOOKING_HANDOVER,
          entityId: finalBooking._id.toString(),
          userId: leaserId,
          targetDate: finalBooking.dates.checkIn,
          title: "Handover Reminder",
          message: `The renter is collecting "${listingName}" soon. Please have the item ready for handover.`,
          data: {
            bookingId: finalBooking._id.toString(),
            listingId,
          },
        });
      }

      let renterMsg = `Your booking ${finalBooking._id?.toString()} status changed to ${finalStatus}.`;

      if (finalStatus === "approved") {
        // Show renter the full breakdown: booking cost + deposit (if any)
        renterMsg = depositAmount > 0
          ? `Your booking for "${listingName}" has been approved. 
        Booking amount: $${totalPaid.toFixed(2)} captured from your card. 
        Security deposit: $${depositAmount.toFixed(2)} refundable to your original payment method upon completion. 
        Total captured: $${totalRenterDeducted.toFixed(2)}. 
        The PIN has been sent to the leaser. Please provide the PIN at check-in.`
          : `Your booking for "${listingName}" has been approved. 
        Stripe payment captured: $${totalPaid.toFixed(2)}. 
        The PIN has been sent to the leaser. Please provide the PIN at check-in.`;
      } else if (finalStatus === "rejected") {
        renterMsg = `Your booking for "${listingName}" has been rejected.`;
        // AFTER
      } else if (finalStatus === "completed") {
        const refundedDeposit = updateFields["_depositRefunded"] || 0;

        renterMsg = refundedDeposit > 0
          ? `The booking for "${listingName}" has been completed. Your security deposit of $${refundedDeposit.toFixed(2)} has been refunded to your original payment method.`
          : depositAmount > 0
            ? `The booking for "${listingName}" has been completed. Your security deposit of $${depositAmount.toFixed(2)} is on hold until the damage dispute window expires. You will be notified once it is released or a dispute is resolved.`
            : `The booking for "${listingName}" has been completed.`;

        // ✅ Send dedicated deposit refund notification
        await notificationQueue.add("booking-completed", {
          userId: leaserId,
          title: "Booking Completed",
          message: `The booking for "${listingName}" has been completed. Your rental earning of $${leaserReceive.toFixed(2)} has been released.`,
          data: {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: "completed",
            creditedAmount: leaserReceive.toFixed(2),
          },
        });

        if (refundedDeposit > 0) {
          await notificationQueue.add("security-deposit-refunded", {
            userId: renterId,
            title: "Security Deposit Refunded",
            message: `Your security deposit of $${refundedDeposit.toFixed(2)} for "${listingName}" has been returned to your original payment method.`,
            data: {
              bookingId: finalBooking._id?.toString(),
              listingId,
              type: "booking",
              status: "completed",
            },
          });

          await notificationQueue.add("security-deposit-released", {
            userId: admin._id as string,
            title: "Security Deposit Released",
            message: `The security deposit of $${refundedDeposit.toFixed(2)} for "${listingName}" has been released from escrow and refunded to the renter.`,
            data: {
              bookingId: finalBooking._id?.toString(),
              listingId,
              type: "booking",
              status: "completed",
              refundedAmount: refundedDeposit,
            },
          });
        }

      } else if (finalStatus === "request_cancelled") {
        renterMsg = `Your booking for "${listingName}" has been cancelled.`;
      } else if (finalStatus === "booking_cancelled") {
        renterMsg = `Your booking for "${listingName}" has been cancelled. Please check the "Refund Info" for eligibility and deduction details as per the policy.`;
      }

      let notificationTitle = `Booking ${finalStatus.replace(/-/g, " ").replace(/_/g, " ")}`;

      if (finalStatus === "booking_cancelled") {
        notificationTitle = "Booking Cancelled";
      } else if (finalStatus === "request_cancelled") {
        notificationTitle = "Request Cancelled";
      } else {
        notificationTitle = `Booking ${finalStatus.charAt(0).toUpperCase() + finalStatus.slice(1)}`;
      }

      const isDamageReportSubmitted = await DamageReport.findOne({ booking: parentBooking._id });

      const finalBookingId = finalBooking._id.toString();

      // Any status other than approved means the pickup/handover is off
      if (finalStatus !== "approved") {
        await cancelReminder(REMINDER.BOOKING_START, finalBookingId);
        await cancelReminder(REMINDER.BOOKING_PICKUP, finalBookingId);
        await cancelReminder(REMINDER.BOOKING_PAYMENT_PENDING, finalBookingId);
        await cancelReminder(REMINDER.BOOKING_HANDOVER, finalBookingId);
        await cancelReminder(REMINDER.BOOKING_APPROVAL_EXPIRING, finalBookingId);
      }

      if (finalStatus === "completed") {
        // Item is back — stop nagging about the return, start nudging for a review
        await cancelReminder(REMINDER.BOOKING_RETURN, finalBookingId);
        await cancelReminder(REMINDER.BOOKING_RETURN_LEASER, finalBookingId);

        await scheduleReminder({
          type: REMINDER.BOOKING_REVIEW,
          entityId: finalBookingId,
          userId: renterId,
          targetDate: new Date(),
          title: "How was your rental?",
          message: `Your booking for "${listingName}" is complete. Share a review to help others.`,
          data: {
            bookingId: finalBookingId,
            listingId,
          },
        });

        // Both cancelled once the leaser files a damage report
        await scheduleReminder({
          type: REMINDER.BOOKING_INSPECT_ITEM,
          entityId: finalBookingId,
          userId: leaserId,
          targetDate: new Date(),
          title: "Inspect the Returned Item",
          message: `"${listingName}" has been returned. Please inspect it and report any damage before the dispute window closes.`,
          data: {
            bookingId: finalBookingId,
            listingId,
          },
        });

        if (updateFields.disputeWindowEndsAt) {
          await scheduleReminder({
            type: REMINDER.DISPUTE_WINDOW_CLOSING,
            entityId: finalBookingId,
            userId: leaserId,
            targetDate: updateFields.disputeWindowEndsAt,
            title: "Damage Dispute Window Closing",
            message: `The damage dispute window for "${listingName}" closes soon. Report any damage before it expires.`,
            data: {
              bookingId: finalBookingId,
              listingId,
            },
          });
        }
      }

      await notificationQueue.add("booking-status-changed", {
        userId: renterId,
        title: notificationTitle,
        message: renterMsg,
        data: {
          bookingId: finalBooking._id?.toString(),
          listingId,
          type: "booking",
          status: finalStatus,
        },
      });

      if (isDamageReportSubmitted && depositAmount > 0) {
        await notificationQueue.add("booking-completed-deposit-held", {
          userId: leaserId,
          title: "Booking Completed",
          message: `The booking for "${listingName}" is completed. Since a damage report was submitted, the security deposit is currently held in escrow for review.`,
          data: {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: "completed",
          },
        });
      }

      // ========== LEASER NOTIFICATIONS FOR CANCELLATION ==========
      if (finalStatus === "request_cancelled" || finalStatus === "booking_cancelled") {
        let leaserMsg = "";
        let leaserTitle = "";

        if (finalStatus === "request_cancelled") {
          leaserTitle = "Booking Request Cancelled";
          leaserMsg = `The pending booking request for your listing "${listingName}" has been cancelled by the renter.`;
        } else if (finalStatus === "booking_cancelled") {
          leaserTitle = "Approved Booking Cancelled";
          leaserMsg = `The approved booking for "${listingName}" has been cancelled by the renter. Your item is now available for others to book.`;
        }

        await notificationQueue.add("booking-cancelled-leaser", {
          userId: leaserId,
          title: leaserTitle,
          message: leaserMsg,
          data: {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: finalStatus,
          },
        });
      }
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
    const zone = req.query.zone as string | undefined;
    const subCategory = req.query.subCategory as string | undefined; // ✅
    const checkIn = req.query.checkIn as string | undefined;         // ✅
    const checkOut = req.query.checkOut as string | undefined;       // ✅
    const search = req.query.search as string | undefined

    const status = req.query.status as
      | "pending"
      | "approved"
      | "rejected"
      | "completed"
      | "booking_cancelled"
      | "request_cancelled"
      | undefined;

    const filter: any = {};

    if (search) {
      // 1. Find all users whose name matches the search string
      const matchingUsers = await User.find({
        name: { $regex: search, $options: "i" },
      }).distinct("_id");

      // 2. Filter bookings where the leaser is one of those users
      filter.leaser = { $in: matchingUsers };
    }

    if (
      status &&
      ["pending", "approved", "in_progress", "rejected", "completed", "request_cancelled", "booking_cancelled", "expired"].includes(
        status
      )
    ) {
      filter.status = status;
    }

    // If zone filter provided, find all listing IDs in that zone first
    if (zone && mongoose.Types.ObjectId.isValid(zone)) {
      const listingIds = await MarketplaceListing.find({
        zone: new mongoose.Types.ObjectId(zone),
      }).distinct("_id");
      filter.marketplaceListingId = { $in: listingIds };
    }

    // ✅ SubCategory filter — find listings in that subCategory
    if (subCategory && mongoose.Types.ObjectId.isValid(subCategory)) {
      const subCategoryListingIds = await MarketplaceListing.find({
        subCategory: new mongoose.Types.ObjectId(subCategory),
      }).distinct("_id");

      // Merge with existing marketplaceListingId filter if zone was also applied
      if (filter.marketplaceListingId) {
        const zoneIds = filter.marketplaceListingId.$in.map((id: any) => id.toString());
        const subCatIds = subCategoryListingIds.map((id) => id.toString());
        const intersected = zoneIds.filter((id: string) => subCatIds.includes(id));
        filter.marketplaceListingId = {
          $in: intersected.map((id: string) => new mongoose.Types.ObjectId(id)),
        };
      } else {
        filter.marketplaceListingId = { $in: subCategoryListingIds };
      }
    }

    // ✅ CheckIn / CheckOut date range filter
    if (checkIn || checkOut) {
      if (checkIn) {
        filter["dates.checkIn"] = { $gte: new Date(checkIn) };
      }
      if (checkOut) {
        filter["dates.checkOut"] = { $lte: new Date(checkOut) };
      }
    }

    const parentFilter = {
      ...filter,
      previousBookingId: null,
    };

    // everything below is unchanged
    const baseQuery = Booking.find(parentFilter)
      .sort({ createdAt: -1 })
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

    const bookingObjects = data.map((booking: any) =>
      booking?.toObject ? booking.toObject() : booking
    );

    const parentIds = bookingObjects.map((booking: any) => booking._id);
    const childBookings = await Booking.find({
      previousBookingId: { $in: parentIds },
    }).lean();

    const bookingsMap: Record<string, any> = {};
    bookingObjects.forEach((booking: any) => {
      bookingsMap[booking._id.toString()] = { ...booking, extensions: [] };
    });

    childBookings.forEach((child: any) => {
      if (!child.previousBookingId) return;

      const parent = bookingsMap[child.previousBookingId.toString()];
      if (!parent) return;

      const extensionCount = parent.extensions.length + 1;
      parent.extensions.push({
        _id: child._id?.toString?.() ?? child._id,
        name: `Extension ${extensionCount}`,
        extensionDate: child.extensionRequestedDate ?? child.dates?.checkOut ?? null,
        extensionRequestedDate: child.extensionRequestedDate ?? null,
        handover: child.bookingDates?.handover ?? null,
        returnDate: child.bookingDates?.returnDate ?? null,
        priceDetails: child.priceDetails ?? null,
        pricingMeta: child.pricingMeta ?? null,
        extraRequestCharges: child.extraRequestCharges ?? null,
        status: child.status ?? null,
      });
    });

    const bookingsWithExtensions = Object.values(bookingsMap);

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
        bookings: bookingsWithExtensions,
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
            select: "name polygons",
          },
        ],
      })
      .populate("renter", "name email profilePicture")
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
          status: childWithPayment.status ?? null,
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

    const formattedReviews = reviews?.map((r) => ({
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
    const isRefundable = req.query.isRefundable === 'true';

    const status = req.query.status as string | undefined;

    const role = req.query.role as string | undefined;
    const zone = req.query.zone as string | undefined;

    const filter: any = {};

    // Exclude child bookings (extensions) from the main query
    filter.previousBookingId = null;

    if (role === "renter") {
      filter.renter = user.id;
    } else if (role === "leaser") {
      filter.leaser = user.id;
    } else {
      filter.$or = [{ renter: user.id }, { leaser: user.id }];
    }

    if (status) filter.status = status;

    if (isRefundable) {
      filter.refundRequest = null;
    }

    let baseQuery = Booking.find(filter)
      .populate({
        path: "marketplaceListingId",
        match: zone ? { zone } : {},
        populate: {
          path: "zone",
          select: "name polygons",
        },
      })
      .populate("renter", "name email")
      .populate("leaser", "name email")
      .populate({
        path: "refundRequest",
        select: "status reason totalRefundAmount deduction note createdAt"
      })
      .sort({ createdAt: -1 })
      .lean();

    const allBookings = await baseQuery;

    let filteredBookings = zone
      ? allBookings.filter((b) => b.marketplaceListingId !== null)
      : allBookings;

    if (role === "leaser" && status === "pending") {
      const bookingIds = filteredBookings.map((booking) => booking._id);
      const heldBookingIds = await Payment.find({
        bookingId: { $in: bookingIds },
        status: "held",
      }).distinct("bookingId");
      const heldBookingIdSet = new Set(heldBookingIds.map((bookingId) => bookingId.toString()));
      filteredBookings = filteredBookings.filter((booking) =>
        heldBookingIdSet.has(booking._id.toString())
      );
    }

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

    // Fetch all extensions for the parent bookings
    const parentIds = Object.keys(bookingsMap);
    const extensions = await Booking.find({
      previousBookingId: { $in: parentIds },
    }).lean();

    await Promise.all(
      extensions.map(async (booking) => {
        // Add null/undefined check
        if (!booking.previousBookingId) return;

        const parentIdStr = booking.previousBookingId.toString();
        const parent = bookingsMap[parentIdStr];
        if (parent) {
          const extensionCount = parent.extensions.length + 1;
          const childWithPayment = await attachPaymentStatus(booking);

          parent.extensions.push({
            _id: childWithPayment._id?.toString?.() ?? childWithPayment._id,
            name: `Extension ${extensionCount}`,
            extensionDate: childWithPayment.extensionRequestedDate ?? childWithPayment.dates?.checkOut ?? null,  // ✅ correct
            extensionRequestedDate: childWithPayment.extensionRequestedDate ?? null,  //
            handover: childWithPayment.bookingDates?.handover ?? null,
            returnDate: childWithPayment.bookingDates?.returnDate ?? null,
            priceDetails: childWithPayment.priceDetails ?? null,
            pricingMeta: childWithPayment.pricingMeta ?? null,
            extraRequestCharges: childWithPayment.extraRequestCharges ?? null,
            status: childWithPayment.status ?? null,
          });
        }
      })
    );

    const mergedBookings = Object.values(bookingsMap);

    const total = mergedBookings.length;
    const paginatedBookings = mergedBookings.slice(
      (page - 1) * limit,
      page * limit
    );

    let finalBookings = paginatedBookings;

    // Works for all roles now
    const bookingIds = paginatedBookings.map((b: any) => b._id);

    const damageReports = await DamageReport.find({
      booking: { $in: bookingIds },
    }).lean();

    const damageReportMap = new Map(
      damageReports.map((d) => [String(d.booking), d])
    );

    finalBookings = paginatedBookings.map((booking: any) => {
      const report = damageReportMap.get(String(booking._id)) || null;
      return {
        ...booking,
        damagedReport: report,
        hasDamagedReport: report !== null,
      };
    });

    finalBookings = await Promise.all(
      finalBookings.map(async (booking: any) => {
        const listing = booking.marketplaceListingId as any;

        await checkAndUpdateBookingExpiry(booking)

        // --- 1. EXPIRY LOGIC (With Skip Filter) ---
        // In statuses par expiry check nahi chalega
        const skipStatuses = ["completed", "cancelled", "request_cancelled", "booking_cancelled", "expired", "rejected", "in_progress"];

        if (listing && !skipStatuses.includes(booking.status)) {
          const isExpired = isBookingExpiredForApproval(booking, listing.priceUnit);

          if (isExpired && booking.status !== "expired") {
            await releaseBookingPaymentHold(booking._id);
            await Booking.findByIdAndUpdate(booking._id, { status: "expired" });
            booking.status = "expired"; // Local object update taake niche same data mile

            try {
              await notificationQueue.add("booking-expired", {
                userId: booking.renter?._id?.toString() ?? booking.renter?.toString(),
                title: "Booking Expired",
                message: `Your booking for "${listing.name}" has expired as the checkout date has already passed.`,
                data: {
                  bookingId: booking._id.toString(),
                  listingId: listing._id.toString(),
                  type: "booking_expired",
                },
              });
            } catch (err) {
              console.error("Notification failed:", err);
            }
          }
        }

        // --- 2. REVIEW & RATING LOGIC (Same as your original) ---
        const review = await Review.findOne({
          bookingId: booking._id,
          userId: user.id,
        }).lean();

        const listingId = booking.marketplaceListingId?._id ?? booking.marketplaceListingId;

        const listingBookings = await Booking.find({ marketplaceListingId: listingId })
          .select("_id")
          .lean();

        const listingBookingIds = listingBookings.map((b: any) => b._id);

        const listingReviews = await Review.find({ bookingId: { $in: listingBookingIds } })
          .select("stars")
          .lean();

        const totalReviews = listingReviews.length;
        const averageRating =
          totalReviews > 0
            ? listingReviews.reduce((sum: number, r: any) => sum + (r.stars || 0), 0) / totalReviews
            : 0;

        // --- 3. RETURN DATA (Same structure) ---
        return {
          // Agar booking Mongoose document hai toh .toObject() use karein, warna direct failao
          ...(booking.toObject ? booking.toObject() : booking),
          status: booking.status, // Updated status if expired
          isReviewSubmitted: review ? true : false,
          averageRating,
          totalReviews
        };
      })
    );

    return sendResponse(res, {
      statusCode: STATUS_CODES.OK,
      success: true,
      message: "Bookings retrieved successfully",
      data: {
        bookings: finalBookings,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getRenterBookingById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const userId = req?.user?.id;
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
      .populate({
        path: "marketplaceListingId",
        populate: [
          {
            path: "leaser",
            select: "name email profilePicture",
          },
          {
            path: "zone",
            select: "name polygons",
          },
        ],
      })
      .populate("renter", "name email profilePicture")
      .populate({
        path: "refundRequest",
        select: "status reason totalRefundAmount deduction note createdAt"
      })
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
          status: childWithPayment.status ?? null,
        };
      })
    );

    const damageReport = await DamageReport.findOne({ booking: id }).lean();

    const result = {
      ...booking,
      extensions,
    };

    const review = await Review.findOne({ bookingId: id, userId: userId })
      .lean();

    const isReviewSubmitted = review ? true : false;

    const listingId = (booking?.marketplaceListingId as any)?._id ?? booking?.marketplaceListingId;
    const listingBookings = await Booking.find({ marketplaceListingId: listingId })
      .select("_id")
      .lean();
    const listingBookingIds = listingBookings.map((b: any) => b._id);
    const listingReviews = await Review.find({ bookingId: { $in: listingBookingIds } })
      .select("stars")
      .lean();

    const totalReviews = listingReviews.length;
    const averageRating =
      totalReviews > 0
        ? listingReviews.reduce((sum: number, r: any) => sum + (r.stars || 0), 0) / totalReviews
        : 0;

    const finalResult = {
      ...result,
      isReviewSubmitted,
      totalReviews,
      averageRating,
      damagedReport: damageReport ?? null,
      hasDamagedReport: damageReport !== null,
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

// UPDATE
export const updateBooking = async (
  req: Request,
  res: Response,
) => {
  try {
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
  const session = await mongoose.startSession();

  try {
    const user = (req as AuthRequest).user;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    session.startTransaction();

    const booking = await Booking.findById(id)
      .populate("renter", "wallet email name fcmToken")
      .populate("leaser", "wallet email name fcmToken")
      .populate("marketplaceListingId", "name")
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const childBookings = await Booking.find({ previousBookingId: booking._id })
      .session(session)
      .lean();

    const childBookingIds = childBookings.map((child: any) => child._id);

    const shouldRefundRenter =
      user?.role === "admin" &&
      ["approved", "in_progress"].includes(booking.status);

    let refundedAmount = 0;
    let leaserDebitedAmount = 0;
    let adminDebitedAmount = 0;
    let adminId = "";
    if (shouldRefundRenter) {
      const admin = await User.findOne({ role: "admin" }).session(session);

      const bookingPrice = Number(booking.priceDetails?.price) || 0;
      const adminFee = Number(booking.priceDetails?.adminFee) || 0;
      const tax = Number(booking.priceDetails?.tax) || 0;
      const securityDeposit = Number(booking.priceDetails?.securityDeposit) || 0;
      const extraCharges = Number(booking.extraRequestCharges?.additionalCharges) || 0;
      const extensionCharges = Number(booking.extendCharges?.extendCharges) || 0;
      const childExtensionCharges = childBookings.reduce((total: number, child: any) => {
        if (!["approved", "in_progress"].includes(child.status)) return total;

        return total +
          (Number(child.priceDetails?.price) || 0) +
          (Number(child.extraRequestCharges?.additionalCharges) || 0) +
          (Number(child.extendCharges?.extendCharges) || 0);
      }, 0);

      leaserDebitedAmount = Number(
        (bookingPrice + extraCharges + extensionCharges + childExtensionCharges).toFixed(2)
      );
      adminDebitedAmount = Number((adminFee + tax + securityDeposit).toFixed(2));
      refundedAmount = Number((leaserDebitedAmount + adminDebitedAmount).toFixed(2));

      if (refundedAmount > 0) {
        await refundBookingPaymentAmount(booking._id, refundedAmount, session);
        await Payment.updateMany(
          {
            bookingId: { $in: [booking._id, ...childBookingIds] },
            type: { $in: ["booking", "extension"] },
            status: { $in: ["captured", "payout_pending", "partially_refunded"] },
          },
          { $set: { status: "refunded", refundedAt: new Date() } },
          { session }
        );
      }

      adminId = admin?._id ? (admin._id as Types.ObjectId).toString() : "";
    }
    await Booking.deleteMany({
      $or: [
        { _id: booking._id },
        { previousBookingId: booking._id },
      ],
    }).session(session);

    await session.commitTransaction();

    try {
      const renter = booking.renter as any;
      const leaser = booking.leaser as any;
      const listing = booking.marketplaceListingId as any;
      const listingName = listing?.name || "your booking";
      const bookingId = booking._id.toString();
      const listingId = listing?._id?.toString() || booking.marketplaceListingId?.toString();

      if (renter?._id) {
        await notificationQueue.add("booking-deleted", {
          userId: renter._id.toString(),
          title: "Booking Deleted",
          message: refundedAmount > 0
            ? `Your booking for "${listingName}" has been deleted by admin. $${refundedAmount.toFixed(2)} has been refunded to your wallet.`
            : `Your booking for "${listingName}" has been deleted by admin.`,
          data: {
            bookingId,
            listingId,
            type: "booking",
            status: "booking_deleted",
            refundedAmount,
            deletedChildBookingIds: childBookingIds.map((childId: any) => childId.toString()),
          },
        });
      }

      if (leaser?._id) {
        await notificationQueue.add("booking-deleted", {
          userId: leaser._id.toString(),
          title: "Booking Deleted",
          message: leaserDebitedAmount > 0
            ? `The booking for "${listingName}" has been deleted by admin. $${leaserDebitedAmount.toFixed(2)} has been reversed from your wallet.`
            : `The booking for "${listingName}" has been deleted by admin.`,
          data: {
            bookingId,
            listingId,
            type: "booking",
            status: "booking_deleted",
            debitedAmount: leaserDebitedAmount,
            deletedChildBookingIds: childBookingIds.map((childId: any) => childId.toString()),
          },
        });
      }

      if (adminId) {
        await notificationQueue.add("booking-deleted-admin", {
          userId: adminId,
          title: "Booking Deleted by Admin",
          message: `The booking for "${listingName}" has been successfully deleted. A refund of $${refundedAmount.toFixed(2)} was issued to the renter, $${leaserDebitedAmount.toFixed(2)} was reversed from the leaser, and $${adminDebitedAmount.toFixed(2)} was reversed from the admin account.`,
          data: {
            bookingId,
            listingId,
            type: "booking",
            status: "booking_deleted",
            refundedAmount,
            leaserDebitedAmount,
            adminDebitedAmount,
            deletedChildBookingIds: childBookingIds.map((childId: any) => childId.toString()),
          },
        });
      }
    } catch (err) {
      console.error("Failed to notify users about deleted booking:", err);
    }

    sendResponse(
      res,
      {
        deletedBookingId: booking._id,
        deletedChildBookingIds: childBookingIds,
        refundedAmount,
        leaserDebitedAmount,
        adminDebitedAmount,
      },
      "Booking deleted",
      STATUS_CODES.OK
    );
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
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
      .populate("leaser", "email name fcmToken")
      .populate("marketplaceListingId", "timezone name");


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

    const isDateOnlyBooking = booking.pricingMeta.unit !== "hour";

    if (isDateOnlyBooking) {
      const listing = booking.marketplaceListingId as IMarketplaceListing | null;
      const timezone = listing?.timezone || "UTC";

      const nowInZone = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
      const todayStr = nowInZone.toISOString().split("T")[0];

      const checkInStr = checkIn.toISOString().split("T")[0];
      const checkOutStr = checkOut.toISOString().split("T")[0];

      console.log({
        unit: booking.pricingMeta.unit,
        timezone,
        nowUTC: now.toISOString(),
        nowInZone: nowInZone.toISOString(),
        todayStr,
        checkInStr,
        checkOutStr,
      });

      if (todayStr < checkInStr) {
        return sendResponse(res, null,
          "PIN submission not allowed before the check-in date.",
          STATUS_CODES.BAD_REQUEST
        );
      }

      if (todayStr > checkOutStr) {
        return sendResponse(res, null,
          "PIN has expired after checkout date.",
          STATUS_CODES.BAD_REQUEST
        );
      }
    } else {
      if (now < checkIn) {
        return sendResponse(res, null,
          "PIN submission not allowed before the check-in time.",
          STATUS_CODES.BAD_REQUEST
        );
      }
      if (now > checkOut) {
        return sendResponse(res, null,
          "PIN has expired because check-out time has passed.",
          STATUS_CODES.BAD_REQUEST
        );
      }
    }

    const isRunning = isDateOnlyBooking ? true : now >= checkIn && now <= checkOut;

    if (booking.status === "approved" && isRunning) {
      if (!booking.bookingDates) booking.bookingDates = {};
      if (!booking.bookingDates.handover) booking.bookingDates.handover = now;

      booking.otp = "";
      booking.isVerified = true;
      booking.status = "in_progress";
      // Renter holds this one; the leaser enters it when the item comes back
      booking.returnOtp = generatePIN(4);

      await booking.save();

      // Item is collected — pre-pickup reminders are no longer relevant
      await cancelReminder(REMINDER.BOOKING_START, booking._id.toString());
      await cancelReminder(REMINDER.BOOKING_PICKUP, booking._id.toString());
      await cancelReminder(REMINDER.BOOKING_HANDOVER, booking._id.toString());

      try {
        const listing = (await MarketplaceListing.findById(
          booking.marketplaceListingId
        )) as IMarketplaceListing | null;

        if (listing) {
          const renter = booking.renter as IUser | null;
          const leaser = booking.leaser as IUser | null;

          // Rental is running — remind both sides before the return is due.
          // Cancelled when the booking is marked completed.
          if (renter?._id) {
            await scheduleReminder({
              type: REMINDER.BOOKING_RETURN,
              entityId: booking._id.toString(),
              userId: renter._id.toString(),
              targetDate: booking.dates.checkOut,
              title: "Return Reminder",
              message: `Your rental of "${listing.name}" is ending soon. Please return the item on time.`,
              data: {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
              },
            });
          }

          if (leaser?._id) {
            await scheduleReminder({
              type: REMINDER.BOOKING_RETURN_LEASER,
              entityId: booking._id.toString(),
              userId: leaser._id.toString(),
              targetDate: booking.dates.checkOut,
              title: "Item Return Due",
              message: `"${listing.name}" is due back soon. Be ready to receive and inspect the item.`,
              data: {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
              },
            });
          }

          if (renter?._id) {
            await notificationQueue.add("booking-started", {
              userId: renter._id.toString(),
              title: "Booking Started",
              message: `Your booking for "${listing.name}" has officially started.`,
              data: {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
                type: "booking_started",
              },
            });

            await notificationQueue.add("return-pin", {
              userId: renter._id.toString(),
              title: "Return Verification PIN",
              message: `Your return PIN for "${listing.name}" is ${booking.returnOtp}. Share it with the leaser when you hand the item back.`,
              data: {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
                type: "return_pin",
                returnOtp: booking.returnOtp,
              },
            });
          }

          if (leaser?._id) {
            await notificationQueue.add("booking-started", {
              userId: leaser._id.toString(),
              title: "Booking Started",
              message: `${renter?.name} has entered the PIN and the booking has begun for "${listing.name}".`,
              data: {
                bookingId: booking._id.toString(),
                listingId: listing._id.toString(),
                type: "booking_started",
              },
            });
          }
        }
      } catch (err) {
        console.error("Failed to notify leaser on booking start:", err);
      }

      return sendResponse(
        res,
        booking,
        "PIN verified and handover recorded. The return PIN has been sent to the renter.",
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
      // Renter holds this one; the leaser enters it when the item comes back
      returnOtp: generatePIN(4),
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
          await notificationQueue.add("booking-started", {
            userId: renter._id.toString(),
            title: "Booking Started",
            message: `Your booking for "${listing.name}" has officially started.`,
            data: {
              bookingId: createdNewBooking._id.toString(),
              listingId: listing._id.toString(),
              type: "booking_started",
            },
          });

          await notificationQueue.add("return-pin", {
            userId: renter._id.toString(),
            title: "Return Verification PIN",
            message: `Your return PIN for "${listing.name}" is ${createdNewBooking.returnOtp}. Share it with the leaser when you hand the item back.`,
            data: {
              bookingId: createdNewBooking._id.toString(),
              listingId: listing._id.toString(),
              type: "return_pin",
              returnOtp: createdNewBooking.returnOtp,
            },
          });
        }

        if (leaser?._id) {
          await notificationQueue.add("booking-started", {
            userId: leaser._id.toString(),
            title: "Booking Started",
            message: `${renter?.name} has entered the PIN and the new booking has begun for "${listing.name}".`,
            data: {
              bookingId: createdNewBooking._id.toString(),
              listingId: listing._id.toString(),
              type: "booking_started",
            },
          });
        }
      }
    } catch (err) {
      console.error("Failed to notify leaser on new booking start:", err);
    }

    return sendResponse(
      res,
      createdNewBooking,
      "New running booking created and handover recorded. The return PIN has been sent to the renter.",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// Verifies the return PIN only. Completing the booking (deposit, payout,
// dispute window) still goes through updateBookingStatus.
export const submitReturnPin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;
    const user = (req as any).user;
    const userId = (user?.id || user?._id)?.toString();

    if (!otp)
      return sendResponse(res, null, "PIN is required", STATUS_CODES.BAD_REQUEST);

    if (!mongoose.Types.ObjectId.isValid(id))
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);

    const booking = await Booking.findById(id);

    if (!booking)
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);

    const leaserId =
      (booking.leaser as any)?._id?.toString() ?? booking.leaser?.toString();

    // The renter holds the PIN, so only the leaser proves the item came back
    if (userId !== leaserId)
      return sendResponse(
        res,
        null,
        "Only the leaser can verify the return PIN",
        STATUS_CODES.FORBIDDEN
      );

    if (booking.returnVerifiedAt)
      return sendResponse(
        res,
        booking,
        "Return already verified",
        STATUS_CODES.OK
      );

    if (booking.status !== "in_progress")
      return sendResponse(
        res,
        null,
        "Return PIN can only be verified while the booking is in progress",
        STATUS_CODES.BAD_REQUEST
      );

    if (!booking.returnOtp || booking.returnOtp !== otp)
      return sendResponse(res, null, "Invalid PIN", STATUS_CODES.BAD_REQUEST);

    booking.returnOtp = "";
    booking.returnVerifiedAt = new Date();
    await booking.save();

    return sendResponse(
      res,
      booking,
      "Return PIN verified. You can now complete the booking.",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// Get Bookings Seasonal Graph
export const getSeasonalBookingsGraph = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const subCategoryId = req.query.subCategory as string | undefined;

    const pipeline: mongoose.PipelineStage[] = [
      ...(subCategoryId && mongoose.Types.ObjectId.isValid(subCategoryId)
        ? [
          {
            $lookup: {
              from: "marketplacelistings",
              localField: "marketplaceListingId",
              foreignField: "_id",
              as: "listing",
            },
          } as mongoose.PipelineStage,
          { $unwind: "$listing" } as mongoose.PipelineStage,
          {
            $match: {
              "listing.subCategory": new mongoose.Types.ObjectId(subCategoryId),
            },
          } as mongoose.PipelineStage,
        ]
        : []),
      {
        $match: {
          createdAt: {
            $gte: new Date(`${year}-01-01T00:00:00.000Z`),
            $lte: new Date(`${year}-12-31T23:59:59.999Z`),
          },
        },
      },
      {
        $addFields: {
          month: { $month: "$createdAt" },
          week: {
            $ceil: {
              $divide: [{ $dayOfMonth: "$createdAt" }, 7],
            },
          },
        },
      },
      {
        $group: {
          _id: { month: "$month", week: "$week" },
          totalBookings: { $sum: 1 },
        },
      },
      { $sort: { "_id.month": 1, "_id.week": 1 } },
    ];

    const raw = await Booking.aggregate(pipeline);

    const MONTH_NAMES = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    const result = MONTH_NAMES.map((name, i) => {
      const monthNumber = i + 1;

      const weeks = [1, 2, 3, 4].map((weekNumber) => {
        const found = raw.find(
          (r) => r._id.month === monthNumber && r._id.week === weekNumber
        );
        return {
          week: `Week ${weekNumber}`,
          totalBookings: found?.totalBookings ?? 0,
        };
      });

      return {
        month: name,
        monthNumber,
        weeks,
        totalBookings: weeks.reduce((sum, w) => sum + w.totalBookings, 0),
      };
    });

    return sendResponse(res, {
      statusCode: STATUS_CODES.OK,
      message: "Bookings graph data retrieved successfully",
      data: {
        year,
        category: subCategoryId || null,
        months: result,
      },
    });
  } catch (error) {
    next(error);
  }
};



