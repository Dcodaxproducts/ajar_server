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

        const { marketplaceListingId, ...bookingData } = req.body;

        // 1️⃣ Validate marketplaceListingId and fetch listing
        if (!mongoose.Types.ObjectId.isValid(marketplaceListingId)) {
            return res.status(400).json({ message: "Invalid Marketplace Listing ID" });
        }

        const listing = await MarketplaceListing.findById(marketplaceListingId);
        if (!listing) {
            return res.status(404).json({ message: "Listing not found" });
        }

        if (!listing.isAvailable) {
            return res.status(400).json({ message: "Listing is not available" });
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

        // Assuming AdminFee is the sum of Renter and Leaser Commissions (as a cost to the booking)
        const totalCommissionRate = renterCommissionRate + leaserCommissionRate;

        // Calculate actual amounts
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

    // if (Array.isArray(booking.languages)) {
    //   const match = booking.languages.find((l: any) => l.locale === locale);
    //   if (match?.translations) {
    //     booking.roomType = match.translations.roomType || booking.roomType;
    //     (booking as any).bookingNote =
    //       match.translations.bookingNote || (booking as any).bookingNote;
    //   }
    // }
    // delete booking.languages;

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
        const { status, additionalCharges } = req.body;
        const user = (req as any).user;

        const allowedStatuses = ["approved", "rejected", "completed", "cancelled"];
        if (!allowedStatuses.includes(status)) {
            return sendResponse(res, null, "Invalid status", STATUS_CODES.BAD_REQUEST);
        }

        // Fetch booking to get current priceDetails
        let booking = await Booking.findById(id);
        if (!booking) {
            return sendResponse(res, null, "Booking not found", STATUS_CODES.NOT_FOUND);
        }
        
        // Ensure user is authorized (Leaser/Renter check remains)
        const isRenter = user.id === booking.renter.toString();
        const isLeaser = user.id === booking.leaser?.toString();

        // Restrictions
        if (status === "cancelled" && !isRenter) {
            return sendResponse(res, null, "Only renter can cancel the booking", STATUS_CODES.FORBIDDEN);
        }
        if (["approved", "rejected", "completed"].includes(status) && !isLeaser) {
            return sendResponse(res, null, "Only leaser can change the booking status", STATUS_CODES.FORBIDDEN);
        }
        
        const bookingIdString = booking._id?.toString() as string;
        
        let updateFields: any = { status: status };
        let finalBooking: IBooking | null = null;
        let pin: string | undefined;

        // 🔹 LOGIC FOR approved STATUS
        if (status === "approved") {
            // 1. Check for special request
            if (booking.specialRequest) {
                const additionalAmount = Number(additionalCharges) || 0;

                // 2. Validate if additionalCharges are required but missing
                if (additionalAmount <= 0) {
                    return sendResponse(res, null, "Additional charges are required when approving a booking with a special request.", STATUS_CODES.BAD_REQUEST);
                }

                // 3. Calculate new grand total
                const currentTotalPrice = booking.priceDetails.totalPrice;
                const newGrandTotalPrice = currentTotalPrice + additionalAmount;
                
                // 4. Update the fields using $set notation for reliable sub-document update
                updateFields = {
                    ...updateFields, // include status: 'approved'
                    // Extension charges update: This object will now contain the final grand total
                    extensionCharges: {
                        additionalCharges: additionalAmount,
                        totalPrice: newGrandTotalPrice, // ⬅️ Sets the NEW GRAND TOTAL here ONLY
                    }
                };
            }

            // 5. Generate OTP
            pin = Math.floor(1000 + Math.random() * 9000).toString();
            updateFields.otp = pin;
        }

        // Use findByIdAndUpdate to apply all changes atomically and reliably update nested fields
        finalBooking = await Booking.findByIdAndUpdate(
            id,
            { $set: updateFields },
            { new: true } // Return the updated document
        ).populate("renter", "email name");

        if (!finalBooking) {
            return sendResponse(res, null, "Booking update failed (race condition or not found after update)", STATUS_CODES.INTERNAL_SERVER_ERROR);
        }

        // 6. Send Email if approved
        if (status === "approved" && pin) {
            const userInfo = finalBooking.renter as any;
            
            // Determine the final price to show in the email (using extensionCharges.totalPrice for accuracy)
            const emailFinalPrice = finalBooking.extensionCharges?.totalPrice || finalBooking.priceDetails.totalPrice;
            
            await sendEmail({
                to: userInfo.email,
                name: userInfo.name,
                subject: "Your Booking Confirmation PIN and Final Price",
                content: `Dear ${userInfo.name},\n\nYour booking has been approved. ${
                    finalBooking.specialRequest 
                        ? `A charge of ${finalBooking.extensionCharges?.additionalCharges} was applied for your special request. The new total price is ${emailFinalPrice}. ` 
                        : ''
                }Your confirmation PIN is: ${pin}`,
            });
        }

        // 🔧 Update MarketplaceListing (No change needed here)
        const listing = await MarketplaceListing.findById(finalBooking.marketplaceListingId);
        if (listing) {
            if (status === "approved") {
                listing.isAvailable = false;
                listing.currentBookingId = [
                    ...(listing.currentBookingId || []).filter(item => item.toString() !== bookingIdString), 
                    finalBooking._id as mongoose.Types.ObjectId,
                ];
            } else {
                listing.isAvailable = true;
                listing.currentBookingId = (listing.currentBookingId || []).filter(item => item.toString() !== bookingIdString);
            }
            await listing.save();
        }

        sendResponse(res, finalBooking, `Booking status updated to ${status}`, STATUS_CODES.OK);
    } catch (err) {
        next(err);
    }
};

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
