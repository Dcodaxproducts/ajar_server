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
import { sendNotification } from "../utils/notifications";
import { calculateBookingPrice } from "../utils/calculateBookingPrice";
import { Payment } from "../models/payment.model";
import { WalletTransaction } from "../models/walletTransaction.model";
import { DamageReport } from "../models/damageReport.model";
import { RefundRequest } from "../models/refundRequest.model";
import { Zone } from "../models/zone.model";
import { IRentalDuration, IRentalPolicies } from "../models/rentalPolicy.model";
import { checkAndUpdateBookingExpiry } from "../utils/bookingExpiry";

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
// createBooking
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user as { id: string; role: string };
    if (!user) return res.status(401).json({ message: "Unauthorised" });

    const { marketplaceListingId, dates, extensionDate, ...bookingData } = req.body;

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

    const renter = await User.findById(user.id);
    if (!renter) {
      return res.status(404).json({ message: "Renter not found" });
    }

    // --- SECURITY DEPOSIT + RENTAL POLICY FETCH ---
    // Fetch the zone to get the linked RentalPolicy
    const zone = await Zone.findById(listing.zone).populate<{ rentalPolicies: IRentalPolicies }>("rentalPolicies");
    if (!zone) return res.status(404).json({ message: "Zone not found for this listing" });

    const rentalPolicy = zone.rentalPolicies as IRentalPolicies | null;

    // Determine security deposit amount (0 if policy missing or deposit not required)
    const securityDepositAmount =
      rentalPolicy?.securityDepositRules?.depositRequired
        ? rentalPolicy.securityDepositRules.depositAmount
        : 0;

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
      if (!limitRule) return null; // No rule for this price unit — allow
      console.log({ limitRule })

      const diffMs = checkOut.getTime() - checkIn.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

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
      const extensionEndDate = new Date(extensionDate);

      if (extensionEndDate <= extensionStartDate) {
        return res.status(400).json({
          message: "Extension date must be after previous checkout date",
        });
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
      console.log({ extensionStartDate, extensionEndDate })

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

      // FIX: Use the shared utility for consistent calculation
      const priceBreakdown = calculateBookingPrice({
        basePrice: listing.price,
        unit: listing.priceUnit,
        checkIn: extensionStartDate,
        checkOut: extensionEndDate,
        adminCommissionRate,
        taxRate,
      });

      const priceDetails = {
        price: priceBreakdown.basePrice,
        adminFee: priceBreakdown.adminFee,
        tax: priceBreakdown.tax,
        // Extensions do NOT charge a new deposit — deposit was already held on original booking
        securityDeposit: 0,
        totalPrice: priceBreakdown.totalPrice,
      };

      if (renter.wallet.balance < priceDetails.totalPrice) {
        return res.status(400).json({
          message: "Insufficient wallet balance to request extension. Please add funds.",
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
          unit: listing.priceUnit,
          duration: priceBreakdown.duration,
        },
        isExtend: false,
        previousBookingId: existingActiveBooking._id,
        extensionRequestedDate: extensionEndDate,
        rentalPolicyId: rentalPolicy?._id, // Store which policy was active at time of booking
      });

      try {
        await sendNotification(
          leaserId.toString(),
          "New Extension Request",
          `Renter requested an extension for listing "${listing.name}".`,
          { bookingId: extendedBooking._id.toString(), listingId: listing._id.toString(), type: "extension", status: "pending" }
        );
      } catch (err) { console.error(err); }

      return res.status(201).json({
        message: "Extension request created successfully",
        booking: extendedBooking,
        priceBreakdown,
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
    });

    const priceDetails = {
      price: priceBreakdown.basePrice,
      adminFee: priceBreakdown.adminFee,
      tax: priceBreakdown.tax,
      // Include security deposit from zone's rental policy (0 if not required)
      securityDeposit: securityDepositAmount,
      // Total = booking price + security deposit
      totalPrice: priceBreakdown.totalPrice + securityDepositAmount,
    };

    // --- WALLET BALANCE CHECK (includes security deposit in required amount) ---
    if (renter.wallet.balance < priceDetails.totalPrice) {
      return res.status(400).json({
        message: "Insufficient wallet balance to create booking. Please add funds.",
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
      rentalPolicyId: rentalPolicy?._id, // Store which policy was active at time of booking
    });

    try {
      await sendNotification(
        leaserId.toString(),
        "New Booking Request",
        `Renter booked your listing "${listing.name}".`,
        { bookingId: newBooking._id.toString(), listingId: listing._id.toString(), type: "booking", status: "pending" }
      );
    } catch (err) { console.error(err); }

    return res.status(201).json({
      message: "Booking created successfully",
      booking: newBooking,
      priceBreakdown,
      // Return deposit info so frontend can show the renter what was held
      securityDeposit: {
        amount: securityDepositAmount,
        required: securityDepositAmount > 0,
        conditions: rentalPolicy?.securityDepositRules?.depositConditions ?? "",
      },
    });

  } catch (error) {
    console.error("Error creating booking:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

// export const createBooking = async (req: AuthRequest, res: Response) => {
//   try {
//     const user = req.user as { id: string; role: string };
//     if (!user) return res.status(401).json({ message: "Unauthorised" });

//     const { marketplaceListingId, dates, extensionDate, ...bookingData } = req.body;

//     if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
//       return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
//     }

//     const listing = await MarketplaceListing.findById(marketplaceListingId);
//     if (!listing) return res.status(404).json({ message: "Listing not found" });

//     const listingId = listing._id as Types.ObjectId;
//     const leaserId = listing.leaser as Types.ObjectId;

//     // 1. MOVED UP: Fetch Form first so we have Tax/Commission rates for both Extensions and New Bookings
//     const form = await Form.findOne({ subCategory: listing.subCategory, zone: listing.zone });
//     if (!form) return res.status(400).json({ message: "Form settings not found for this listing" });

//     // Prepare rates
//     const adminCommissionRate = (form.setting.renterCommission.value + form.setting.leaserCommission.value) / 100;
//     const taxRate = form.setting.tax / 100;

//     const renter = await User.findById(user.id);
//     if (!renter) {
//       return res.status(404).json({ message: "Renter not found" });
//     }

//     /* ---------------------------------------------------------
//        EXTENSION LOGIC
//     --------------------------------------------------------- */
//     const existingActiveBooking = await Booking.findOne({
//       renter: user.id,
//       marketplaceListingId: listingId,
//       "bookingDates.handover": { $ne: null },
//       $or: [
//         { "bookingDates.returnDate": { $exists: false } },
//         { "bookingDates.returnDate": null },
//       ],
//     });

//     if (existingActiveBooking) {
//       if (!extensionDate) {
//         return res.status(400).json({ message: "Extension date is required" });
//       }

//       const extensionStartDate = new Date(existingActiveBooking.dates.checkOut);
//       const extensionEndDate = new Date(extensionDate);

//       if (extensionEndDate <= extensionStartDate) {
//         return res.status(400).json({
//           message: "Extension date must be after previous checkout date",
//         });
//       }

//       const isAvailableForExtend = await isBookingDateAvailable(
//         listingId,
//         extensionStartDate,
//         extensionEndDate,
//         existingActiveBooking._id
//       );

//       if (!isAvailableForExtend) {
//         return res.status(400).json({
//           message: "Listing is not available for the selected extension period",
//         });
//       }

//       // FIX: Use the shared utility for consistent calculation
//       const priceBreakdown = calculateBookingPrice({
//         basePrice: listing.price, // Unit price
//         unit: listing.priceUnit,
//         checkIn: extensionStartDate,
//         checkOut: extensionEndDate,
//         adminCommissionRate, // Now available
//         taxRate,             // Now available
//       });

//       const priceDetails = {
//         price: priceBreakdown.basePrice,
//         adminFee: priceBreakdown.adminFee,
//         tax: priceBreakdown.tax,
//         totalPrice: priceBreakdown.totalPrice,
//       };

//       if (renter.wallet.balance < priceDetails.totalPrice) {
//         return res.status(400).json({
//           message: "Insufficient wallet balance to request extension. Please add funds.",
//           requiredBalance: priceDetails.totalPrice,
//           currentBalance: renter.wallet.balance,
//         });
//       }

//       const extendedBooking = await Booking.create({
//         ...bookingData,
//         dates: {
//           checkIn: existingActiveBooking.dates.checkIn,
//           checkOut: extensionEndDate,
//         },
//         renter: user.id,
//         leaser: leaserId,
//         marketplaceListingId: listingId,
//         status: "pending",
//         priceDetails,
//         pricingMeta: {
//           priceFromListing: listing.price,
//           unit: listing.priceUnit,
//           duration: priceBreakdown.duration,
//         },
//         isExtend: false,
//         previousBookingId: existingActiveBooking._id,
//         extensionRequestedDate: extensionEndDate,
//       });

//       // Notify Leaser logic (omitted for brevity, same as before)
//       try {
//         await sendNotification(
//           leaserId.toString(),
//           "New Extension Request",
//           `Renter requested an extension for listing "${listing.name}".`,
//           { bookingId: extendedBooking._id.toString(), listingId: listing._id.toString(), type: "extension", status: "pending" }
//         );
//       } catch (err) { console.error(err); }

//       return res.status(201).json({
//         message: "Extension request created successfully",
//         booking: extendedBooking,
//         priceBreakdown, // Return full breakdown
//       });
//     }

//     /* ---------------------------------------------------------
//        NEW BOOKING LOGIC
//     --------------------------------------------------------- */
//     if (!dates?.checkIn || !dates?.checkOut) {
//       return res.status(400).json({ message: "Booking dates (checkIn & checkOut) are required" });
//     }

//     const { checkIn: checkInDate, checkOut: checkOutDate } = normalizeBookingDates(dates.checkIn, dates.checkOut);

//     let availabilityCheckIn = checkInDate;
//     if (listing.priceUnit === "hour") {
//       availabilityCheckIn = new Date(checkInDate.getTime() + 1);
//     }

//     const isAvailable = await isBookingDateAvailable(
//       listingId,
//       availabilityCheckIn,
//       checkOutDate
//     );

//     if (!isAvailable) {
//       return res.status(400).json({ message: "Listing is already booked for the selected dates" });
//     }

//     // Check required documents
//     const requiredUserDocs = form.userDocuments || [];
//     if (requiredUserDocs.length > 0) {
//       const renterProfile = await User.findById(user.id);
//       if (!renterProfile) return res.status(404).json({ message: "Renter profile not found" });

//       const missingDocs: string[] = [];
//       const unapprovedDocs: string[] = [];

//       for (const requiredDoc of requiredUserDocs) {
//         const userDoc = renterProfile.documents.find((doc: any) => doc.name === requiredDoc);
//         if (!userDoc) missingDocs.push(requiredDoc);
//         else if (userDoc.status !== "approved") unapprovedDocs.push(requiredDoc);
//       }

//       if (missingDocs.length > 0) return res.status(400).json({ message: `Missing docs: ${missingDocs.join(", ")}` });
//       if (unapprovedDocs.length > 0) return res.status(400).json({ message: `Unapproved docs: ${unapprovedDocs.join(", ")}` });
//     }

//     // 2. FIX: Unified Calculation Logic
//     // Removed the "if (sameDay)" block entirely. Use calculateBookingPrice for everything.
//     const priceBreakdown = calculateBookingPrice({
//       basePrice: listing.price,
//       unit: listing.priceUnit,
//       checkIn: checkInDate,
//       checkOut: checkOutDate,
//       adminCommissionRate,
//       taxRate,
//     });

//     const priceDetails = {
//       price: priceBreakdown.basePrice,
//       adminFee: priceBreakdown.adminFee,
//       tax: priceBreakdown.tax,
//       totalPrice: priceBreakdown.totalPrice,
//     };

//     if (renter.wallet.balance < priceDetails.totalPrice) {
//       return res.status(400).json({
//         message: "Insufficient wallet balance to create booking. Please add funds.",
//         requiredBalance: priceDetails.totalPrice,
//         currentBalance: renter.wallet.balance,
//       });
//     }

//     const newBooking = await Booking.create({
//       ...bookingData,
//       dates: { checkIn: checkInDate, checkOut: checkOutDate },
//       renter: user.id,
//       leaser: leaserId,
//       status: "pending",
//       marketplaceListingId: listingId,
//       priceDetails,
//       pricingMeta: {
//         priceFromListing: listing.price,
//         unit: listing.priceUnit,
//         duration: priceBreakdown.duration,
//       },
//     });

//     try {
//       await sendNotification(
//         leaserId.toString(),
//         "New Booking Request",
//         `Renter booked your listing "${listing.name}".`,
//         { bookingId: newBooking._id.toString(), listingId: listing._id.toString(), type: "booking", status: "pending" }
//       );
//     } catch (err) { console.error(err); }

//     return res.status(201).json({
//       message: "Booking created successfully",
//       booking: newBooking,
//       priceBreakdown,
//     });

//   } catch (error) {
//     console.error("Error creating booking:", error);
//     return res.status(500).json({ message: "Server error", error });
//   }
// };



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
      // Inside isExtendApproval block, add rejected case
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

        childBooking.status = "rejected";
        await childBooking.save({ session });

        await session.commitTransaction();
        session.endSession();

        try {
          await sendNotification(
            renterId,
            "Extension Rejected",
            `Your extension request for "${listingName}" has been rejected.`,
            {
              bookingId: childBooking._id.toString(),
              type: "extension",
              status: "rejected",
            }
          );

          await sendNotification(
            leaserId,
            "Extension Rejected",
            `You have rejected the extension request for "${listingName}".`,
            {
              bookingId: childBooking._id.toString(),
              type: "extension",
              status: "rejected",
            }
          );
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

      const renter = parentBooking.renter as any;
      const leaser = parentBooking.leaser as any;

      const { price, adminFee, tax } = childBooking.priceDetails;
      const extendChargeAmount = Number(additionalCharges) || 0;

      const renterPay = price + adminFee + tax + extendChargeAmount;
      const leaserReceive = price + extendChargeAmount;
      const adminReceive = adminFee + tax;

      // Wallet check
      if (!renter?.wallet || renter.wallet.balance < renterPay) {
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
              requiredBalance: renterPay,
              currentBalance: renter.wallet?.balance || 0,
            }
          );
        } catch (err) {
          console.error("Failed to notify renter about wallet issue:", err);
        }

        return sendResponse(
          res,
          {
            requiredBalance: renterPay,
            currentBalance: renter.wallet?.balance || 0,
          },
          "Insufficient wallet balance for extension approval",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // Deduct renter wallet & credit leaser
      renter.wallet.balance -= renterPay;
      await renter.save({ session });

      if (leaser?.wallet) {
        leaser.wallet.balance += leaserReceive;
        await leaser.save({ session });
      }

      if (admin?.wallet) {
        admin.wallet.balance += adminReceive;
        await admin.save({ session });
      }

      await WalletTransaction.insertMany(
        [
          {
            userId: renter._id,
            type: "debit",
            amount: renterPay,
            source: "booking",
            status: "succeeded",
            createdAt: new Date(),
            requestedAt: new Date(),
          },
          {
            userId: leaser._id,
            type: "credit",
            amount: leaserReceive,
            source: "booking",
            status: "succeeded",
            createdAt: new Date(),
            requestedAt: new Date(),
          },
          {
            userId: admin._id,
            type: "credit",
            amount: adminReceive,
            source: "booking",
            status: "succeeded",
            createdAt: new Date(),
            requestedAt: new Date(),
            processedAt: new Date(),
          }
        ],
        { session }
      );

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

        await sendNotification(
          renterId,
          "Extension Approved",
          `Your extension request for "${listingName}" has been approved. Amount deducted from your wallet: $${renterPay.toFixed(2)}.`,
          {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            deductedAmount: renterPay, // ADDED
          }
        );

        // ADDED: LEASER NOTIFICATION (wallet credit)
        await sendNotification(
          leaserId,
          "Extension Approved",
          `The extension for "${listingName}" is approved. Amount deducted from user's wallet: $${renterPay.toFixed(2)}.`,
          {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            deductedAmount: renterPay
          }
        );

        await sendNotification(
          leaserId,
          "Payment Received",
          `You received $${leaserReceive.toFixed(2)} in your wallet for the extension of "${listingName}".`,
          {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            creditedAmount: leaserReceive,
          }
        );

        await sendNotification(
          admin._id as string,
          "Extension Fee Received",
          `You received $${adminReceive.toFixed(2)} (admin fee + tax) for the extension of "${listingName}".`,
          {
            bookingId: childBooking._id.toString(),
            type: "extension",
            status: "approved",
            creditedAmount: adminReceive,
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

      if (hasSpecialRequest && specialCharges <= 0) {
        return sendResponse(
          res,
          null,
          "Special request charges must be applied for this booking",
          STATUS_CODES.BAD_REQUEST
        );
      }

      const { price, adminFee, tax, securityDeposit } = parentBooking.priceDetails;

      const depositAmount = securityDeposit || 0;

      const renterPay = price + adminFee + tax + specialCharges;
      const leaserReceive = price + specialCharges;
      const adminReceive = adminFee + tax;

      // Total amount renter needs: booking cost + security deposit held in escrow
      const totalRenterDeduct = renterPay + depositAmount;

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
      if (renter.wallet.balance < totalRenterDeduct) {
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
              requiredBalance: totalRenterDeduct,
              currentBalance: renter.wallet.balance,
            }
          );
        } catch (err) {
          console.error("Failed to notify renter about wallet issue:", err);
        }

        return sendResponse(
          res,
          {
            requiredBalance: totalRenterDeduct,
            currentBalance: renter.wallet.balance,
          },
          "Insufficient wallet balance. Booking cannot be approved.",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // Deduct from renter
      renter.wallet.balance -= totalRenterDeduct;
      await renter.save({ session });

      // Credit leaser
      if (leaser?.wallet) {
        leaser.wallet.balance += leaserReceive;
        await leaser.save({ session });
      }

      // Credit admin
      if (admin?.wallet) {
        admin.wallet.balance += adminReceive + depositAmount;
        await admin.save({ session });
      }


      // Wallet transactions
      const walletTxns: any[] = [
        {
          userId: renter._id,
          type: "debit",
          amount: renterPay,
          source: "booking",
          status: "succeeded",
          createdAt: new Date(),
          requestedAt: new Date(),
        },
        {
          userId: leaser._id,
          type: "credit",
          amount: leaserReceive,
          source: "booking",
          status: "succeeded",
          createdAt: new Date(),
          requestedAt: new Date(),
        },
        {
          userId: admin._id,
          type: "credit",
          amount: adminReceive,
          source: "booking",
          status: "succeeded",
          createdAt: new Date(),
          requestedAt: new Date(),
          processedAt: new Date(),
        },
      ];

      // Only add a separate deposit transaction if there actually is a deposit
      if (depositAmount > 0) {
        walletTxns.push(
          // Debit deposit from renter separately so it's clearly traceable
          {
            userId: renter._id,
            type: "debit",
            amount: depositAmount,
            source: "booking",
            status: "succeeded",
            note: "Security deposit held in escrow — refundable upon booking completion",
            createdAt: new Date(),
            requestedAt: new Date(),
          },
          // Credit deposit to admin escrow
          {
            userId: admin._id,
            type: "credit",
            amount: depositAmount,
            source: "booking",
            status: "succeeded",
            note: "Security deposit received into escrow for booking",
            createdAt: new Date(),
            requestedAt: new Date(),
            processedAt: new Date(),
          }
        );
      }

      await WalletTransaction.insertMany(walletTxns, { session });

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
      updateFields["bookingDates.returnDate"] = new Date();
      updateFields["_depositRefunded"] = 0;

      const isDamageReportSubmitted = await DamageReport.findOne({ booking: parentBooking._id });

      // ✅ Refund security deposit back to renter ONLY if no damage report
      const depositAmount = parentBooking.priceDetails?.securityDeposit || 0;

      if (depositAmount > 0 && !isDamageReportSubmitted) {
        const renter = parentBooking.renter as any;
        const renterId = renter?._id?.toString() || renter?.toString();

        // Re-fetch renter to get latest wallet balance
        const renterUser = await User.findById(renterId).session(session);

        if (renterUser?.wallet) {
          renterUser.wallet.balance += depositAmount;
          await renterUser.save({ session });
        }

        // Deduct from admin escrow
        if (admin?.wallet) {
          admin.wallet.balance -= depositAmount;
          await admin.save({ session });
        }

        // Record wallet transactions
        await WalletTransaction.insertMany(
          [
            {
              userId: renterId,
              type: "credit",
              amount: depositAmount,
              source: "refund",
              status: "succeeded",
              note: "Security deposit refunded upon booking completion",
              createdAt: new Date(),
              requestedAt: new Date(),
              processedAt: new Date(),
            },
            {
              userId: admin._id,
              type: "debit",
              amount: depositAmount,
              source: "refund",
              status: "succeeded",
              note: "Security deposit released from escrow to renter",
              createdAt: new Date(),
              requestedAt: new Date(),
              processedAt: new Date(),
            },
          ],
          { session }
        );

        updateFields["_depositRefunded"] = depositAmount;
      }
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
          `The booking for "${listingName}" is approved. PIN Code: ${pin}. Amount deducted from User's wallet: $${totalRenterDeducted.toFixed(2)}.`,
          {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: finalStatus,
            deductedAmount: totalRenterDeducted.toFixed(2),
          }
        );

        await sendNotification(
          leaser._id.toString(),
          "Payment Received",
          `You received $${leaserReceive.toFixed(2)} in your wallet for the booking of "${listingName}".`,
          {
            bookingId: finalBooking._id.toString(),
            type: "booking",
            status: "approved",
            creditedAmount: leaserReceive.toFixed(2),
          }
        );

        await sendNotification(
          admin._id as string,
          "Booking Fee Received",
          `You received $${adminReceive.toFixed(2)} (admin fee + tax) for the booking of "${listingName}".`,
          {
            bookingId: finalBooking._id.toString(),
            type: "booking",
            status: "approved",
            creditedAmount: adminReceive.toFixed(2),
          }
        );
        if (depositAmount > 0) {
          await sendNotification(
            admin._id as string,
            "Security Deposit Received",
            `A security deposit of $${depositAmount.toFixed(2)} has been held in escrow for the booking of "${listingName}". This will be refunded to the renter upon successful completion.`,
            {
              bookingId: finalBooking._id.toString(),
              type: "booking",
              status: "approved",
              depositAmount,
            }
          );
        }
      }

      let renterMsg = `Your booking ${finalBooking._id?.toString()} status changed to ${finalStatus}.`;

      if (finalStatus === "approved") {
        // Show renter the full breakdown: booking cost + deposit (if any)
        renterMsg = depositAmount > 0
          ? `Your booking for "${listingName}" has been approved. 
        Booking amount: $${totalPaid.toFixed(2)} deducted from your wallet. 
        Security deposit: $${depositAmount.toFixed(2)} held in escrow (refundable upon completion). 
        Total deducted: $${totalRenterDeducted.toFixed(2)}. 
        The PIN has been sent to the leaser. Please provide the PIN at check-in.`
          : `Your booking for "${listingName}" has been approved. 
        Amount deducted from your wallet: $${totalPaid.toFixed(2)}. 
        The PIN has been sent to the leaser. Please provide the PIN at check-in.`;
      } else if (finalStatus === "rejected") {
        renterMsg = `Your booking for "${listingName}" has been rejected.`;
        // AFTER
      } else if (finalStatus === "completed") {
        const refundedDeposit = updateFields["_depositRefunded"] || 0;

        renterMsg = refundedDeposit > 0
          ? `The booking for "${listingName}" has been completed. Your security deposit of $${refundedDeposit.toFixed(2)} has been refunded to your wallet.`
          : depositAmount > 0
            ? `The booking for "${listingName}" has been completed. Your security deposit of $${depositAmount.toFixed(2)} is currently on hold pending the damage report review. You will be notified once the report is resolved.`
            : `The booking for "${listingName}" has been completed.`;

        // ✅ Send dedicated deposit refund notification
        if (refundedDeposit > 0) {
          await sendNotification(
            renterId,
            "Security Deposit Refunded",
            `Your security deposit of $${refundedDeposit.toFixed(2)} for "${listingName}" has been returned to your wallet.`,
            {
              bookingId: finalBooking._id?.toString(),
              listingId,
              type: "booking",
              status: "completed",
              refundedAmount: refundedDeposit,
            }
          );

          await sendNotification(
            leaserId,
            "Booking Completed",
            `The booking for "${listingName}" has been completed.`,
            {
              bookingId: finalBooking._id?.toString(),
              listingId,
              type: "booking",
              status: "completed",
              refundedAmount: refundedDeposit,
            }
          );

          await sendNotification(
            admin._id as string,
            "Security Deposit Released",
            `The security deposit of $${refundedDeposit.toFixed(2)} for "${listingName}" has been released from escrow and refunded to the renter.`,
            {
              bookingId: finalBooking._id?.toString(),
              listingId,
              type: "booking",
              status: "completed",
              refundedAmount: refundedDeposit,
            }
          );
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

      await sendNotification(renterId, notificationTitle, renterMsg, {
        bookingId: finalBooking._id?.toString(),
        listingId,
        type: "booking",
        status: finalStatus,
      });

      if (isDamageReportSubmitted && depositAmount > 0) {
        await sendNotification(
          leaserId,
          "Booking Completed",
          `The booking for "${listingName}" is completed. Since a damage report was submitted, the security deposit is currently held in escrow for review.`,
          {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: "completed",
          }
        );
      }

      // ========== LEASER NOTIFICATIONS FOR CANCELLATION ==========
      if (finalStatus === "request_cancelled" || finalStatus === "booking_cancelled") {
        let leaserMsg = "";
        let leaserTitle = "";

        if (finalStatus === "request_cancelled") {
          leaserTitle = "Booking Request Cancelled";
          leaserMsg = `The pending booking request for your listing "${listingName}" has been cancelled by the renter.`;
        } else if (finalStatus === "booking_cancelled") {
          leaserTitle = "Confirmed Booking Cancelled";
          leaserMsg = `The approved booking for "${listingName}" has been cancelled by the renter. Your item is now available for others to book.`;
        }

        await sendNotification(
          leaserId,
          leaserTitle,
          leaserMsg,
          {
            bookingId: finalBooking._id?.toString(),
            listingId,
            type: "booking",
            status: finalStatus,
          }
        );
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

    // everything below is unchanged
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
            select: "name polygons rentalPolicies",
            populate: {
              path: "rentalPolicies",
            },
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
          select: "name polygons rentalPolicies",
          populate: {
            path: "rentalPolicies",
          },
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
            extensionDate: childWithPayment.dates?.checkOut ?? null,
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
        const skipStatuses = ["completed", "cancelled", "request_cancelled", "booking_cancelled", "expired", "rejected"];

        if (listing && !skipStatuses.includes(booking.status)) {
          const isExpired = isBookingExpiredForApproval(booking, listing.priceUnit);

          if (isExpired && booking.status !== "expired") {
            await Booking.findByIdAndUpdate(booking._id, { status: "expired" });
            booking.status = "expired"; // Local object update taake niche same data mile

            try {
              await sendNotification(
                booking.renter?._id?.toString() ?? booking.renter?.toString(),
                "Booking Expired",
                `Your booking for "${listing.name}" has expired as the checkout date has already passed.`,
                {
                  bookingId: booking._id.toString(),
                  listingId: listing._id.toString(),
                  type: "booking_expired",
                }
              );
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
            select: "name polygons rentalPolicies",
            populate: {
              path: "rentalPolicies",
            },
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

// export const getBookingsByUser = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     const user = (req as any).user;
//     const page = Number(req.query.page) || 1;
//     const limit = Number(req.query.limit) || 10;

//     const status = req.query.status as string | undefined;
//     const role = req.query.role as string | undefined;
//     const zone = req.query.zone as string | undefined;

//     const filter: any = {};

//     if (role === "renter") {
//       filter.renter = user.id;
//     } else if (role === "leaser") {
//       filter.leaser = user.id;
//     } else {
//       filter.$or = [{ renter: user.id }, { leaser: user.id }];
//     }

//     if (status) filter.status = status;

//     let baseQuery = Booking.find(filter)
//       .populate({
//         path: "marketplaceListingId",
//         match: zone ? { zone } : {},
//         populate: {
//           path: "zone",
//           select: "name",
//         },
//       })
//       .populate("renter", "firstName lastName email")
//       .populate("leaser", "firstName lastName email")
//       .sort({ createdAt: -1 })
//       .lean();

//     const allBookings = await baseQuery;

//     const filteredBookings = zone
//       ? allBookings.filter((b) => b.marketplaceListingId !== null)
//       : allBookings;

//     const bookingsMap: Record<string, any> = {};

//     filteredBookings.forEach((booking) => {
//       bookingsMap[booking._id.toString()] = { ...booking, extensions: [] };
//     });

//     await Promise.all(
//       Object.values(bookingsMap).map(async (parent: any) => {
//         const parentWithPayment = await attachPaymentStatus(parent);
//         Object.assign(parent, parentWithPayment);
//       })
//     );

//     await Promise.all(
//       filteredBookings.map(async (booking) => {
//         if (booking.previousBookingId) {
//           const parentIdStr = booking.previousBookingId.toString();
//           const parent = bookingsMap[parentIdStr];
//           if (parent) {
//             const extensionCount = parent.extensions.length + 1;
//             const childWithPayment = await attachPaymentStatus(booking);

//             parent.extensions.push({
//               _id: childWithPayment._id?.toString?.() ?? childWithPayment._id,
//               name: `Extension ${extensionCount}`,
//               extensionDate: childWithPayment.dates?.checkOut ?? null,
//               handover: childWithPayment.bookingDates?.handover ?? null,
//               returnDate: childWithPayment.bookingDates?.returnDate ?? null,
//               priceDetails: childWithPayment.priceDetails ?? null,
//               pricingMeta: childWithPayment.pricingMeta ?? null,
//               extraRequestCharges: childWithPayment.extraRequestCharges ?? null,
//               paymentStatus: childWithPayment.paymentStatus ?? null,
//             });

//             delete bookingsMap[booking._id.toString()];
//           }
//         }
//       })
//     );

//     const mergedBookings = Object.values(bookingsMap);

//     const total = mergedBookings.length;
//     const paginatedBookings = mergedBookings.slice(
//       (page - 1) * limit,
//       page * limit
//     );

//     let finalBookings = paginatedBookings;

//     if (role === "leaser") {
//       const bookingIds = paginatedBookings.map((b: any) => b._id);

//       const damageReports = await DamageReport.find({
//         booking: { $in: bookingIds },
//       }).select("booking");

//       const damagedBookingIds = new Set(
//         damageReports.map((d) => String(d.booking))
//       );

//       finalBookings = paginatedBookings.map((booking: any) => ({
//         ...booking,
//         damagedReport: damagedBookingIds.has(String(booking._id)),
//       }));
//     }

//     return sendResponse(res, {
//       statusCode: STATUS_CODES.OK,
//       success: true,
//       message: "Bookings retrieved successfully",
//       data: {
//         bookings: finalBookings,
//         total,
//         page,
//         limit,
//       },
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// UPDATE
export const updateBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
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

// controllers/booking.controller.ts

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
