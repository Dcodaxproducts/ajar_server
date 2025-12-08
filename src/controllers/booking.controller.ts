import { Request, Response, NextFunction } from "express";
import { Booking, IBooking } from "../models/booking.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { sendEmail } from "../helpers/node-mailer";
import { IUser, User } from "../models/user.model";
import { IMarketplaceListing, MarketplaceListing } from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Types } from "mongoose";
import { Form } from "../models/form.model";
import { generatePIN } from "../utils/generatePin";
import { Review } from "../models/review.model";
import { isBookingDateAvailable } from "../utils/dateValidator";
import { sendNotification } from "../utils/notifications";

//createBooking
// export const createBooking = async (req: AuthRequest, res: Response) => {
//   try {
//     const user = req.user as { id: string; role: string; name?: string; email?: string };
//     if (!user) return res.status(401).json({ message: "Unauthorised" });

//     const { marketplaceListingId, dates, extensionDate, ...bookingData } = req.body;

//     // Validate listing id
//     if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
//       return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
//     }

//     const listing = await MarketplaceListing.findById(marketplaceListingId);
//     if (!listing) return res.status(404).json({ message: "Listing not found" });

//     const listingId = listing._id as Types.ObjectId;
//     const leaserId = listing.leaser as Types.ObjectId;

//     // Detect extension if renter already has active booking
//     const existingActiveBooking = await Booking.findOne({
//       renter: user.id,
//       marketplaceListingId: listingId,
//       "bookingDates.handover": { $ne: null },
//       $or: [
//         { "bookingDates.returnDate": { $exists: false } },
//         { "bookingDates.returnDate": null },
//       ],
//     });

//     // ---------------------- EXTENSION REQUEST ----------------------
//     if (existingActiveBooking) {
//       if (!extensionDate) {
//         return res.status(400).json({ message: "Extension date is required" });
//       }

//       const checkInDate = new Date(existingActiveBooking.dates.checkIn);
//       const checkOutDate = new Date(extensionDate);

//       if (checkOutDate <= checkInDate) {
//         return res.status(400).json({
//           message:
//             "Extension date must be after the current booking's check-in date",
//         });
//       }

//       // Check availability for extension
//       const isAvailableForExtend = await isBookingDateAvailable(
//         listingId,
//         checkInDate,
//         checkOutDate,
//         existingActiveBooking._id
//       );

//       if (!isAvailableForExtend) {
//         return res.status(400).json({
//           message: "The listing is not available for the selected extended date.",
//         });
//       }

//       // Fetch form
//       const form = await Form.findOne({
//         subCategory: listing.subCategory,
//         zone: listing.zone,
//       });
//       if (!form) return res.status(400).json({ message: "Form not found for this listing" });

//       const basePrice = listing.price;
//       const renterCommissionRate = form.setting.renterCommission.value / 100;
//       const leaserCommissionRate = form.setting.leaserCommission.value / 100;
//       const taxRate = form.setting.tax / 100;

//       const totalCommissionRate = renterCommissionRate + leaserCommissionRate;
//       const commissionAmount = basePrice * totalCommissionRate;
//       const taxAmount = (basePrice + commissionAmount) * taxRate;
//       const finalPrice = basePrice + commissionAmount + taxAmount;

//       const priceDetails = {
//         price: basePrice,
//         adminFee: commissionAmount,
//         tax: taxAmount,
//         totalPrice: finalPrice,
//       };

//       const extendedBooking = await Booking.create({
//         ...bookingData,
//         dates: {
//           checkIn: existingActiveBooking.dates.checkIn,
//           checkOut: checkOutDate,
//         },
//         renter: user.id,
//         leaser: leaserId,
//         status: "pending",
//         marketplaceListingId: listingId,
//         priceDetails,
//         isExtend: false,
//         previousBookingId: existingActiveBooking._id,
//         extensionRequestedDate: checkOutDate,
//       });

      
//       //----------------- NOTIFY LEASER ABOUT EXTENSION REQUEST -----------------

//       try {
//         const renterName = user.name || user.email || "A user";
//         await sendNotification(
//           leaserId.toString(),
//           "Extension Request Received", // CHANGED: Notification title
//           `${renterName} requested an extension for your listing "${listing.name}".`, // CHANGED: Message
//           { bookingId: extendedBooking._id.toString(), type: "extension" } // CHANGED: Type "extension"
//         );
//       } catch (err) {
//         console.error("Failed to notify leaser about extension request:", err); // CHANGED: added error log
//       }

//       return res.status(201).json({
//         message: "Extension request created successfully.",
//         booking: extendedBooking,
//       });
//     }

//     // ---------------------- NORMAL BOOKING ----------------------
//     if (!dates?.checkIn || !dates?.checkOut) {
//       return res.status(400).json({ message: "Booking dates (checkIn & checkOut) are required" });
//     }

//     const checkInDate = new Date(dates.checkIn);
//     const checkOutDate = new Date(dates.checkOut);

//     // Check availability
//     const isAvailable = await isBookingDateAvailable(listingId, checkInDate, checkOutDate);
//     if (!isAvailable) {
//       return res.status(400).json({
//         message: "Listing is already booked for the selected dates. Please choose different dates.",
//       });
//     }

//     // Fetch form
//     const form = await Form.findOne({ subCategory: listing.subCategory, zone: listing.zone });
//     if (!form) return res.status(400).json({ message: "Form not found for this listing" });

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

//       if (missingDocs.length > 0) {
//         return res.status(400).json({
//           message: `Booking requires the following document(s): ${missingDocs.join(", ")}`,
//         });
//       }
//       if (unapprovedDocs.length > 0) {
//         return res.status(400).json({
//           message: `The following document(s) are not approved yet: ${unapprovedDocs.join(", ")}.`,
//         });
//       }
//     }

//     // Price calculation
//     const basePrice = listing.price;
//     const renterCommissionRate = form.setting.renterCommission.value / 100;
//     const leaserCommissionRate = form.setting.leaserCommission.value / 100;
//     const taxRate = form.setting.tax / 100;

//     const totalCommissionRate = renterCommissionRate + leaserCommissionRate;
//     const commissionAmount = basePrice * totalCommissionRate;
//     const taxAmount = (basePrice + commissionAmount) * taxRate;
//     const finalPrice = basePrice + commissionAmount + taxAmount;

//     const priceDetails = {
//       price: basePrice,
//       adminFee: commissionAmount,
//       tax: taxAmount,
//       totalPrice: finalPrice,
//     };

//     const newBooking: IBooking = await Booking.create({
//       ...bookingData,
//       dates: { checkIn: checkInDate, checkOut: checkOutDate },
//       renter: user.id,
//       leaser: leaserId,
//       status: "pending",
//       marketplaceListingId: listingId,
//       priceDetails,
//     });

//     // Update listing current bookings
//     (listing as any).currentBookingId = [newBooking._id];
//     await listing.save();

//     // Notify leaser
//     try {
//       const renterName = user.name || user.email || "A user";
//       await sendNotification(
//         leaserId.toString(),
//         "New Booking Request",
//         `${renterName} requested to book your listing "${listing.name}" from ${checkInDate.toISOString().split("T")[0]} to ${checkOutDate.toISOString().split("T")[0]}.`,
//         { bookingId: newBooking._id.toString(), listingId: listingId.toString(), type: "booking" }
//       );
//     } catch (err) {
//       console.error("Failed to notify leaser about new booking:", err);
//     }

//     return res.status(201).json({
//       message: "Booking created successfully",
//       booking: newBooking,
//     });
//   } catch (error) {
//     console.error("Error creating booking:", error);
//     return res.status(500).json({ message: "Server error", error });
//   }
// };

// createBooking
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user as { id: string; role: string; name?: string; email?: string };
    if (!user) return res.status(401).json({ message: "Unauthorised" });

    const { marketplaceListingId, dates, extensionDate, ...bookingData } = req.body;

    // Validate listing id
    if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
      return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
    }

    const listing = await MarketplaceListing.findById(marketplaceListingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    const listingId = listing._id as Types.ObjectId;
    const leaserId = listing.leaser as Types.ObjectId;

    // Detect extension if renter already has active booking
    const existingActiveBooking = await Booking.findOne({
      renter: user.id,
      marketplaceListingId: listingId,
      "bookingDates.handover": { $ne: null },
      $or: [
        { "bookingDates.returnDate": { $exists: false } },
        { "bookingDates.returnDate": null },
      ],
    });

    // ---------------------- EXTENSION REQUEST ----------------------
    if (existingActiveBooking) {
      if (!extensionDate) {
        return res.status(400).json({ message: "Extension date is required" });
      }

      const checkInDate = new Date(existingActiveBooking.dates.checkIn);
      const checkOutDate = new Date(extensionDate);

      if (checkOutDate <= checkInDate) {
        return res.status(400).json({
          message: "Extension date must be after the current booking's check-in date",
        });
      }

      // Check availability for extension
      const isAvailableForExtend = await isBookingDateAvailable(
        listingId,
        checkInDate,
        checkOutDate,
        existingActiveBooking._id
      );

      if (!isAvailableForExtend) {
        return res.status(400).json({
          message: "The listing is not available for the selected extended date.",
        });
      }

      // Fetch form
      const form = await Form.findOne({
        subCategory: listing.subCategory,
        zone: listing.zone,
      });
      if (!form) return res.status(400).json({ message: "Form not found for this listing" });

      // CHANGED: price calculation helper (admin fee + tax included)
      const basePrice = listing.price;
      const renterCommissionRate = form.setting.renterCommission.value / 100;
      const leaserCommissionRate = form.setting.leaserCommission.value / 100;
      const taxRate = form.setting.tax / 100;

      const totalCommissionRate = renterCommissionRate + leaserCommissionRate;

      const calculatePrice = (price: number) => {
        const adminFee = price * totalCommissionRate;
        const tax = (price + adminFee) * taxRate;
        const totalPrice = price + adminFee + tax;
        return { adminFee, tax, totalPrice };
      };

      // CHANGED: use helper
      const priceCalc = calculatePrice(basePrice);

      const priceDetails = {
        price: basePrice,
        adminFee: priceCalc.adminFee,
        tax: priceCalc.tax,
        totalPrice: priceCalc.totalPrice,
      };

      const extendedBooking = await Booking.create({
        ...bookingData,
        dates: {
          checkIn: existingActiveBooking.dates.checkIn,
          checkOut: checkOutDate,
        },
        renter: user.id,
        leaser: leaserId,
        status: "pending",
        marketplaceListingId: listingId,
        priceDetails,
        isExtend: false,
        previousBookingId: existingActiveBooking._id,
        extensionRequestedDate: checkOutDate,
      });

      // Notify leaser about extension
      try {
        const renterName = user.name || user.email || "A user";
        await sendNotification(
          leaserId.toString(),
          "Extension Request Received",
          `${renterName} requested an extension for your listing "${listing.name}".`,
          { bookingId: extendedBooking._id.toString(), type: "extension" }
        );
      } catch (err) {
        console.error("Failed to notify leaser about extension request:", err);
      }

      return res.status(201).json({
        message: "Extension request created successfully.",
        booking: extendedBooking,
      });
    }

    // ---------------------- NORMAL BOOKING ----------------------
    if (!dates?.checkIn || !dates?.checkOut) {
      return res.status(400).json({ message: "Booking dates (checkIn & checkOut) are required" });
    }

    const checkInDate = new Date(dates.checkIn);
    const checkOutDate = new Date(dates.checkOut);

    // Check availability
    const isAvailable = await isBookingDateAvailable(listingId, checkInDate, checkOutDate);
    if (!isAvailable) {
      return res.status(400).json({
        message: "Listing is already booked for the selected dates. Please choose different dates.",
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

    // CHANGED: reuse same price helper for normal booking
    const basePrice = listing.price;
    const renterCommissionRate = form.setting.renterCommission.value / 100;
    const leaserCommissionRate = form.setting.leaserCommission.value / 100;
    const taxRate = form.setting.tax / 100;

    const totalCommissionRate = renterCommissionRate + leaserCommissionRate;

    const calculatePrice = (price: number) => {
      const adminFee = price * totalCommissionRate;
      const tax = (price + adminFee) * taxRate;
      const totalPrice = price + adminFee + tax;
      return { adminFee, tax, totalPrice };
    };

    const priceCalc = calculatePrice(basePrice);

    const priceDetails = {
      price: basePrice,
      adminFee: priceCalc.adminFee,
      tax: priceCalc.tax,
      totalPrice: priceCalc.totalPrice,
    };

    const newBooking: IBooking = await Booking.create({
      ...bookingData,
      dates: { checkIn: checkInDate, checkOut: checkOutDate },
      renter: user.id,
      leaser: leaserId,
      status: "pending",
      marketplaceListingId: listingId,
      priceDetails,
    });

    // Update listing current bookings (UNCHANGED)
    (listing as any).currentBookingId = [newBooking._id];
    await listing.save();

    // Notify leaser (UNCHANGED)
    try {
      const renterName = user.name || user.email || "A user";
      await sendNotification(
        leaserId.toString(),
        "New Booking Request",
        `${renterName} requested to book your listing "${listing.name}" from ${checkInDate.toISOString().split("T")[0]} to ${checkOutDate.toISOString().split("T")[0]}.`,
        { bookingId: newBooking._id.toString(), listingId: listingId.toString(), type: "booking" }
      );
    } catch (err) {
      console.error("Failed to notify leaser about new booking:", err);
    }

    return res.status(201).json({
      message: "Booking created successfully",
      booking: newBooking,
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};


 //updateBookingStatus
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
      .populate("renter", "email name fcmToken")
      .populate("leaser", "email name fcmToken")
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

    // Extract listing name safely
    const listingName =
      typeof parentBooking.marketplaceListingId === "object" &&
      "name" in parentBooking.marketplaceListingId
        ? (parentBooking.marketplaceListingId as any).name
        : "";

    // EXTENSION APPROVAL LOGIC
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

        const {
          price,
          adminFee,
          tax,
          totalPrice: baseTotal,
        } = parentBooking.priceDetails || {};
        const previousExtra =
          parentBooking.extraRequestCharges?.additionalCharges || 0;

        const afterExtra = baseTotal + previousExtra;
        const newTotalPrice = afterExtra + extendChargeAmount;

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

        const parentId = childBooking.previousBookingId;
        if (parentId) {
          const previousBooking = await Booking.findById(parentId).session(
            session
          );

          if (previousBooking) {
            const parentReturnDate =
              previousBooking.bookingDates?.returnDate || new Date();
            const handoverDate =
              parentReturnDate > new Date()
                ? previousBooking.bookingDates?.returnDate
                : new Date();

            childBooking.bookingDates = {
              ...childBooking.bookingDates,
              handover: handoverDate,
              returnDate: undefined,
            };

            previousBooking.bookingDates = {
              ...previousBooking.bookingDates,
              returnDate: handoverDate,
            };

            previousBooking.isExtend = true;
            await previousBooking.save({ session });

            let topParent = previousBooking;
            while (topParent.previousBookingId) {
              const grandParent = await Booking.findById(
                topParent.previousBookingId
              ).session(session);
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

        //Safe notification for renter
        try {
          const childRenterId =
            typeof childBooking.renter === "object"
              ? (childBooking.renter as any)?._id?.toString()
              : (childBooking.renter as any)?.toString();

          await sendNotification(
            childRenterId,
            "Extension Approved",
            `Your extension request for listing "${listingName}" has been approved.`,
            { bookingId: childBooking._id?.toString(), type: "extension", status: "approved" }
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

      if (finalStatus === "rejected") {
        childBooking.status = "rejected";
        childBooking.isExtend = false;
        (childBooking as any).extensionRequestedDate = undefined;
        await childBooking.save({ session });

        await session.commitTransaction();
        session.endSession();

       try {
          const childRenterId =
            typeof childBooking.renter === "object"
              ? (childBooking.renter as any)?._id?.toString()
              : (childBooking.renter as any)?.toString();

          await sendNotification(
            childRenterId,
            "Extension Rejected",
            `Your extension request for listing "${listingName}" has been rejected.`,
            { bookingId: childBooking._id?.toString(), type: "extension", status: "rejected" }
          );
        } catch (err) {
          console.error("Failed to notify renter about extension rejection:", err);
        }

        return sendResponse(
          res,
          childBooking,
          "Extension request rejected",
          STATUS_CODES.OK
        );
      }
    }

    // NORMAL APPROVAL FLOW
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

    if (finalStatus === "completed") {
      updateFields["bookingDates.returnDate"] = new Date();
    }

    finalBooking = await Booking.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    ).populate("renter", "email name fcmToken");

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

    if (finalStatus === "completed") {
      const lastChild = await Booking.findOne({ previousBookingId: id }).sort({
        createdAt: -1,
      });

      if (lastChild) {
        lastChild.bookingDates = {
          ...lastChild.bookingDates,
          returnDate: new Date(),
        };
        await lastChild.save({ session });
      }

      parentBooking.bookingDates = {
        ...parentBooking.bookingDates,
        returnDate: new Date(),
      };
      await parentBooking.save({ session });
    }

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

   // ---------------------- Notify renter about booking status changes ----------------------
    try {
      const renter = finalBooking.renter as any;
      const renterId =
        typeof renter === "object" ? renter._id?.toString() : renter?.toString();

      let message = `Your booking ${finalBooking._id?.toString()} status changed to ${finalStatus}.`;
      if (finalStatus === "approved") {
        message = `Your booking for "${listingName}" has been approved. OTP: ${pin || ""}`;
      } else if (finalStatus === "rejected") {
        message = `Your booking for "${listingName}" has been rejected.`;
      } else if (finalStatus === "completed") {
        message = `The booking for "${listingName}" has been marked as completed.`;
      } else if (finalStatus === "cancelled") {
        message = `Your booking for "${listingName}" has been cancelled.`;
      }

      await sendNotification(
        renterId,
        `Booking ${finalStatus}`,
        message,
        {
          bookingId: finalBooking._id?.toString(),
          listingId: listing?._id?.toString() || "",
          type: "booking",
          status: finalStatus,
        }
      );
    } catch (err) {
      console.error("Failed to notify renter about booking status change:", err);
    }
    // -------------------------------------------------------
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

    const allBookings = await Booking.find(filter).populate({
        path: "leaser",
        select: "name",
      }).lean();

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

    // Fetch booking
    const booking = await Booking.findById(id)
      .populate("marketplaceListingId")
      .populate("renter")
      .lean();

    if (!booking) {
      sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    //Fetch all reviews for this booking
    const reviews = await Review.find({ bookingId: id })
      .populate("userId", "name email")
      .lean();

    //Format reviews array
    const formattedReviews = reviews.map((r) => ({
      user: r.userId,
      review: {
        stars: r.stars,
        comment: r.comment,
        createdAt: r.createdAt,
      },
    }));

    //Combine booking + reviews
    const result = {
      ...booking,
      reviews: formattedReviews,
    };

    sendResponse(
      res,
      result,
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

    //Build dynamic filter
    const filter: any = {};

    if (role === "renter") {
      filter.renter = user.id;
    } else if (role === "leaser") {
      filter.leaser = user.id;
    } else {
      filter.$or = [{ renter: user.id }, { leaser: user.id }];
    }

    if (status) filter.status = status;

    //Query base
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

          // Only include limited details (handover, returnDate)
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

// submitBookingPin
export const submitBookingPin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    // --------------------- Validate input ---------------------
    if (!otp)
      return sendResponse(res, null, "PIN is required", STATUS_CODES.BAD_REQUEST);

    if (!mongoose.Types.ObjectId.isValid(id))
      return sendResponse(res, null, "Invalid booking ID", STATUS_CODES.BAD_REQUEST);

    // --------------------- Fetch booking ---------------------
    const booking = await Booking.findById(id)
      .populate("renter", "email name fcmToken")
      .populate("leaser", "email name fcmToken");

    if (!booking)
      return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);

    // --------------------- Check OTP ---------------------
    if (booking.otp !== otp)
      return sendResponse(res, null, "Invalid or expired PIN", STATUS_CODES.UNAUTHORIZED);

    const now = new Date();
    const checkIn = new Date(booking.dates.checkIn);
    const checkOut = new Date(booking.dates.checkOut);

    if (now < checkIn)
      return sendResponse(res, null, "PIN submission not allowed before check-in time.", STATUS_CODES.BAD_REQUEST);

    if (now > checkOut)
      return sendResponse(res, null, "PIN has expired after checkout date.", STATUS_CODES.BAD_REQUEST);

    const isRunning = now >= checkIn && now <= checkOut;

    // --------------------- CASE A: Active booking ---------------------
    if (booking.status === "approved" && isRunning) {
      if (!booking.bookingDates) booking.bookingDates = {};
      if (!booking.bookingDates.handover) booking.bookingDates.handover = now;

      booking.otp = "";
      booking.isVerified = true;
      await booking.save();

      // -------------------- Notify leaser about booking start --------------------
      try {
        const listing = await MarketplaceListing.findById(
          booking.marketplaceListingId
        ) as IMarketplaceListing | null; // cast fixes type errors

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

    // --------------------- CASE B: Create new booking (handover) ---------------------
    const newBookingData: any = {
      status: "approved",
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
    booking.isVerified = true;
    await booking.save();

    // -------------------- Notify leaser for new booking handover --------------------
    try {
      const listing = await MarketplaceListing.findById(
        createdNewBooking.marketplaceListingId
      ) as IMarketplaceListing | null;

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
