import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Zone } from "../models/zone.model";
import { SubCategory } from "../models/category.model";
import { Form } from "../models/form.model";
import { Booking } from "../models/booking.model";
import { User } from "../models/user.model";
import { Review } from "../models/review.model";
import { sendNotification } from "../utils/notifications";
import { FavouriteCheck } from "../models/favouriteChecks.model";
import { Dropdown } from "../models/dropdown.model";

// controllers/marketplaceListings.controller.ts]
const toCamelCase = (str: string) =>
  str
    .replace(/([-_][a-z])/gi, (s) =>
      s.toUpperCase().replace("-", "").replace("_", "")
    )
    .replace(/^[A-Z]/, (s) => s.toLowerCase());

export const createMarketplaceListing = async (req: any, res: Response) => {
  try {
    const { zone, subCategory } = req.body;
    const leaser = req.user.id;

    // Normalize body keys
    const normalisedBody: any = {};
    for (const key of Object.keys(req.body)) {
      normalisedBody[toCamelCase(key)] = req.body[key];
    }

    // Early validation for required fields
    const requiredFields = ["name", "subTitle", "price", "priceUnit"];
    for (const field of requiredFields) {
      if (!normalisedBody[field]) {
        console.log(`Missing required body field: ${field}`);
        return res.status(400).json({
          success: false,
          message: `${field} is required`,
        });
      }
    }

    // validate allowed price units
    const validUnits = ["hour", "day", "month", "year"];
    if (!validUnits.includes(normalisedBody.priceUnit)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priceUnit. Allowed: hour, day, month, year",
      });
    }

    // Load Form and Leaser Document Validation Config
    const [form, leaserDocConfig] = await Promise.all([
      Form.findOne({
        zone: new mongoose.Types.ObjectId(zone),
        subCategory: new mongoose.Types.ObjectId(subCategory),
      }).populate("fields"),
      Dropdown.findOne({ name: "leaserDocuments" })
    ]);

    if (!form) {
      return res.status(400).json({
        success: false,
        message: "Form not found for this Zone/SubCategory",
      });
    }

    // Handle uploaded files and separate them
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const generalImages: string[] = [];
    const rentalImages: string[] = [];
    const listingDocs: any[] = [];

    const requiredDocs = (form as any).leaserDocuments || [];
    const uploadedDocNames = uploadedFiles.map((file) => file.fieldname);

    // Check for required rentalImages
    const hasRentalImages = uploadedFiles.some(
      (file) => file.fieldname === "rentalImages"
    );
    if (!hasRentalImages) {
      return res.status(400).json({
        success: false,
        message: "rentalImages is required",
      });
    }

    // Check for missing required documents
    if (requiredDocs.length > 0) {
      const missingDocs = requiredDocs.filter(
        (docName: string) => !uploadedDocNames.includes(docName)
      );
      if (missingDocs.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required document(s): ${missingDocs.join(", ")}`,
          missingDocuments: missingDocs,
        });
      }
    }

    // Separate images and documents with Expiry Validation
    for (const file of uploadedFiles) {
      const filePath = `/uploads/${file.filename}`;
      const fieldName = file.fieldname;

      if (fieldName === "images") {
        generalImages.push(filePath);
      } else if (fieldName === "rentalImages") {
        rentalImages.push(filePath);
      } else {
        // --- Added: Dropdown Expiry Validation ---
        const docRule = leaserDocConfig?.values.find((v) => v.value === fieldName);
        const expiryKey = `${fieldName}_expiry`;
        const rawExpiry = req.body[expiryKey];

        // Validation Error if dropdown says hasExpiry is true but no expiry was sent
        if (docRule?.hasExpiry && !rawExpiry) {
          return res.status(400).json({
            success: false,
            message: `Expiry date is required for document: ${docRule.name || fieldName}`,
          });
        }

        const expiryDate = rawExpiry ? new Date(rawExpiry) : undefined;

        listingDocs.push({
          name: fieldName,
          fileUrl: filePath,
          expiryDate: expiryDate,
          isExpired: expiryDate ? expiryDate < new Date() : false,
        });
      }
    }

    // Validate dynamic fields from form
    const fields = (form as any).fields as any[];
    const requestData: any = {};

    for (const field of fields) {
      const fieldName = toCamelCase(field.name);
      const value = normalisedBody[fieldName];

      // Skip document-type fields (file uploads handled above)
      if (field.type === "document") {
        continue;
      }

      if (field.validation?.required && (value === undefined || value === "")) {
        console.log(`Missing required field: ${field.label}`);
        return res.status(400).json({
          success: false,
          message: `${field.label} is required`,
        });
      }

      if (value !== undefined) requestData[fieldName] = value;
    }

    const listing = new MarketplaceListing({
      leaser,
      zone,
      subCategory,
      documents: listingDocs,
      images: generalImages,
      rentalImages: rentalImages,
      name: normalisedBody.name,
      subTitle: normalisedBody.subTitle,
      price: normalisedBody.price,
      priceUnit: normalisedBody.priceUnit,
      ...requestData,
    });

    await listing.save();
    console.log("Listing created successfully with ID:", listing._id);

    // Notify all admins about new listing
    const admins = await User.find({ role: "admin" }).lean();
    for (const adminUser of admins) {
      try {
        await sendNotification(
          adminUser._id.toString(),
          "New Listing Created",
          `Leaser ${req.user.name || req.user.email || "A user"
          } has created a new listing: ${listing.name}`,
          {
            listingId: (listing._id as mongoose.Types.ObjectId).toString(),
            type: "listing",
          }
        );
      } catch (err) {
        console.error("Error notifying admin:", err);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Listing created successfully",
      data: listing,
    });
  } catch (error) {
    console.error("Server error during listing creation:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// update listing status (admin only)
export const updateListingStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { listingId } = req.params;
    const { status, rejectionNote } = req.body;

    // Only allow valid statuses
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Allowed values: approved, rejected",
      });
    }

    // Require rejectionNote when rejecting
    if (status === "rejected" && !rejectionNote) {
      return res.status(400).json({
        success: false,
        message: "rejectionNote is required when rejecting a listing",
      });
    }


    // Find listing and update status
    const listing = await MarketplaceListing.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: "Listing not found",
      });
    }

    listing.status = status;
    listing.rejectionNote = status === "rejected" ? rejectionNote : null;
    await listing.save();

    // Notify leaser about status update
    try {
      await sendNotification(
        listing.leaser.toString(),
        `Listing ${status}`,
        `Your listing "${listing.name}" has been ${status}`,
        {
          listingId: (listing._id as mongoose.Types.ObjectId).toString(),
          status,
          type: "listing",
        }
      );
    } catch (err) {
      console.error("Error notifying leaser about listing status:", err);
    }

    return res.status(200).json({
      success: true,
      message: `Listing ${status} successfully`,
      data: listing,
    });
  } catch (error) {
    console.error("Error updating listing status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Get All Marketplace Listings with automatic cleanup
export const getAllMarketplaceListingsforLeaser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const {
      page = 1,
      limit = 10,
      zone,
      subCategory,
      category,
      all,
      recent,
    } = req.query;

    const filter: any = {};

    // ROLE-BASED FILTERS
    if (req.user) {
      if (req.user.role === "admin") {
        if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
          filter.zone = new mongoose.Types.ObjectId(String(zone));
        }
      } else {
        if (all === "true") {
          filter.status = "approved";
          if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
            filter.zone = new mongoose.Types.ObjectId(String(zone));
          }
        } else {
          filter.leaser = new mongoose.Types.ObjectId(String(req.user.id));
          if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
            filter.zone = new mongoose.Types.ObjectId(String(zone));
          }
        }
      }
    } else {
      filter.status = "approved";
      if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
        filter.zone = new mongoose.Types.ObjectId(String(zone));
      }
    }

    // CATEGORY & SUBCATEGORY FILTERS
    if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
      filter.subCategory = new mongoose.Types.ObjectId(String(subCategory));
    }

    if (category && mongoose.Types.ObjectId.isValid(String(category))) {
      const subCategoryIds = await SubCategory.find({
        category: category,
      }).distinct("_id");
      filter.subCategory = { $in: subCategoryIds };
    }

    // AGGREGATION PIPELINE
    const pipeline: any[] = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "categories",
          localField: "subCategory",
          foreignField: "_id",
          as: "subCategory",
        },
      },
      { $unwind: "$subCategory" },
      {
        $lookup: {
          from: "users",
          localField: "leaser",
          foreignField: "_id",
          as: "leaser",
        },
      },
      { $unwind: "$leaser" },
      {
        $lookup: {
          from: "zones",
          localField: "zone",
          foreignField: "_id",
          as: "zone",
        },
      },
      { $unwind: "$zone" },
      {
        $lookup: {
          from: "bookings",
          localField: "_id",
          foreignField: "marketplaceListingId",
          as: "bookings",
        },
      },
      {
        $lookup: {
          from: "reviews",
          localField: "bookings._id",
          foreignField: "bookingId",
          as: "reviews",
        },
      },
      {
        $addFields: {
          averageRating: { $avg: "$reviews.stars" },
          totalReviews: { $size: "$reviews" },
        },
      },
      {
        $lookup: {
          from: "forms",
          let: { subCatId: "$subCategory._id", zoneId: "$zone._id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$subCategory", "$$subCatId"] },
                    { $eq: ["$zone", "$$zoneId"] },
                  ],
                },
              },
            },
            {
              $project: {
                userDocuments: 1,
                leaserDocuments: 1,
              },
            },
          ],
          as: "form",
        },
      },
      {
        $addFields: {
          userDocuments: { $ifNull: [{ $arrayElemAt: ["$form.userDocuments", 0] }, []] },
          leaserDocuments: { $ifNull: [{ $arrayElemAt: ["$form.leaserDocuments", 0] }, []] },
        },
      },
      // --- FIXED: form is removed, but 'documents' is kept ---
      { $project: { form: 0 } },

      ...(recent === "true" ? [{ $sort: { createdAt: -1 } }] : []),
      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) },
    ];

    const listings = await MarketplaceListing.aggregate(pipeline).session(session);
    const total = await MarketplaceListing.countDocuments(filter).session(session);

    // LANGUAGE HANDLING
    const final = listings.map((obj: any) => {
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description = listingLang.translations.description || obj.description;
      }
      delete obj.languages;
      return obj;
    });

    const uniqueUserIds = await MarketplaceListing.distinct("leaser", filter).session(session);
    const totalUsersWithListings = uniqueUserIds.length;

    await session.commitTransaction();
    session.endSession();

    sendResponse(
      res,
      {
        listings: final,
        total,
        page: +page,
        limit: +limit,
        totalUsersWithListings,
        totalMarketplaceListings: total,
      },
      `Fetched listings${locale !== "en" ? ` (locale: ${locale})` : ""}`,
      STATUS_CODES.OK
    );
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// UPDATED getAllMarketplaceListings — added reviews, average rating, adminFee & tax
export const getAllMarketplaceListings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const {
      page = 1,
      limit = 10,
      zone,
      subCategory,
      category,
      all,
      recent,
      minPrice,
      maxPrice,
    } = req.query;

    const filter: any = {};

    /* ---------------- ROLE BASED FILTERS ---------------- */
    if (req.user) {
      if (req.user.role === "admin") {
        if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
          filter.zone = new mongoose.Types.ObjectId(String(zone));
        }
      } else {
        if (all === "true") {
          filter.status = "approved";
          if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
            filter.zone = new mongoose.Types.ObjectId(String(zone));
          }
        } else {
          filter.leaser = new mongoose.Types.ObjectId(String(req.user.id));
          if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
            filter.zone = new mongoose.Types.ObjectId(String(zone));
          }
        }
      }
    } else {
      filter.status = "approved";
      if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
        filter.zone = new mongoose.Types.ObjectId(String(zone));
      }
    }

    /* ---------------- CATEGORY FILTERS ---------------- */
    if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
      filter.subCategory = new mongoose.Types.ObjectId(String(subCategory));
    }

    if (category && mongoose.Types.ObjectId.isValid(String(category))) {
      const subCategoryIds = await SubCategory.find({
        category,
      }).distinct("_id");
      filter.subCategory = { $in: subCategoryIds };
    }

    /* ---------------- PRICE FILTER ---------------- */
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    /* ---------------- AGGREGATION ---------------- */
    const pipeline: any[] = [
      { $match: filter },

      // **SORT LATEST FIRST**
      { $sort: { createdAt: -1 } },

      {
        $lookup: {
          from: "categories",
          localField: "subCategory",
          foreignField: "_id",
          as: "subCategory",
        },
      },
      { $unwind: "$subCategory" },

      {
        $lookup: {
          from: "users",
          localField: "leaser",
          foreignField: "_id",
          as: "leaser",
        },
      },
      { $unwind: "$leaser" },

      {
        $lookup: {
          from: "zones",
          localField: "zone",
          foreignField: "_id",
          as: "zone",
        },
      },
      { $unwind: "$zone" },

      /* ---------------- BOOKINGS & REVIEWS ---------------- */
      {
        $lookup: {
          from: "bookings",
          localField: "_id",
          foreignField: "marketplaceListingId",
          as: "bookings",
        },
      },
      {
        $lookup: {
          from: "reviews",
          localField: "bookings._id",
          foreignField: "bookingId",
          as: "reviews",
        },
      },
      {
        $addFields: {
          averageRating: { $avg: "$reviews.stars" },
          totalReviews: { $size: "$reviews" },
        },
      },

      /* ---------------- FORM LOOKUP ---------------- */
      {
        $lookup: {
          from: "forms",
          let: { subCatId: "$subCategory._id", zoneId: "$zone._id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$subCategory", "$$subCatId"] },
                    { $eq: ["$zone", "$$zoneId"] },
                  ],
                },
              },
            },
            {
              $project: {
                setting: 1,
                userDocuments: 1,
                leaserDocuments: 1,
              },
            },
          ],
          as: "form",
        },
      },

      /* ---------------- ADMIN FEE & TAX (SAME AS BOOKING) ---------------- */
      {
        $addFields: {
          userDocuments: {
            $ifNull: [{ $arrayElemAt: ["$form.userDocuments", 0] }, []],
          },
          leaserDocuments: {
            $ifNull: [{ $arrayElemAt: ["$form.leaserDocuments", 0] }, []],
          },

          // Extract setting once
          _setting: { $arrayElemAt: ["$form.setting", 0] },
        },
      },
      {
        $addFields: {
          adminFee: {
            $multiply: [
              "$price",
              {
                $divide: [
                  {
                    $add: [
                      "$_setting.renterCommission.value",
                      "$_setting.leaserCommission.value",
                    ],
                  },
                  100,
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          tax: {
            $multiply: [
              { $add: ["$price", "$adminFee"] },
              { $divide: ["$_setting.tax", 100] },
            ],
          },
        },
      },

      /* ---------------- CLEANUP ---------------- */
      { $project: { form: 0, _setting: 0 } },
      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) },
    ];

    if (recent === "true") pipeline.push({ $sort: { createdAt: -1 } });

    const listings = await MarketplaceListing.aggregate(pipeline).session(
      session
    );
    const total = await MarketplaceListing.countDocuments(filter).session(
      session
    );

    /* ---------------- LANGUAGE HANDLING ---------------- */
    const final = listings.map((obj: any) => {
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description =
          listingLang.translations.description || obj.description;
      }
      delete obj.languages;
      return obj;
    });

    const uniqueUserIds = await MarketplaceListing.distinct(
      "leaser",
      filter
    ).session(session);

    await session.commitTransaction();
    session.endSession();

    sendResponse(
      res,
      {
        listings: final,
        total,
        page: +page,
        limit: +limit,
        totalUsersWithListings: uniqueUserIds.length,
        totalMarketplaceListings: total,
      },
      "Marketplace listings fetched successfully",
      STATUS_CODES.OK
    );
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// UPDATED getMarketplaceListingByIdforLeaser
//adminFee & tax added using SAME logic as booking & getAllMarketplaceListings
export const getMarketplaceListingByIdforLeaser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const doc: any = await MarketplaceListing.findById(id)
      .populate({
        path: "subCategory",
        select: "name languages category",
        populate: { path: "category", select: "name" },
      })
      .populate("leaser", "name email profilePicture createdAt")
      .populate("zone")
      .session(session)
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // --- OPTIMIZED LOGIC: CHECK FOR EXPIRED & EXPIRING SOON ---
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    let needsUpdate = false;

    const expiredDocNames: string[] = [];
    const expiringSoonDocNames: string[] = [];

    // Loop through documents to check status
    doc.documents = (doc.documents || []).map((d: any) => {
      const expiryDate = d.expiryDate ? new Date(d.expiryDate) : null;

      if (expiryDate) {
        // 1. Check for NEWLY EXPIRED
        if (expiryDate < now && d.isExpired !== true) {
          expiredDocNames.push(d.name);
          needsUpdate = true;
          return { ...d, isExpired: true };
        }

        // 2. Check for EXPIRING SOON (7 Days)
        // Only send if it hasn't been sent before (using reminderSent flag)
        if (expiryDate > now && expiryDate <= sevenDaysLater && !d.reminderSent) {
          expiringSoonDocNames.push(d.name);
          needsUpdate = true;
          return { ...d, reminderSent: true };
        }
      }
      return d;
    });

    if (needsUpdate) {
      // Update Database
      await MarketplaceListing.updateOne(
        { _id: id },
        {
          $set: {
            // If any doc is expired, listing must be pending
            status: expiredDocNames.length > 0 ? "pending" : doc.status,
            documents: doc.documents
          }
        },
        { session }
      );

      const leaserId = doc.leaser?._id || doc.leaser;

      // Send Expired Notifications
      if (expiredDocNames.length > 0 && leaserId) {
        await sendNotification(
          leaserId.toString(),
          "Listing Action Required: Document Expired",
          `Your listing "${doc.name}" is now pending because documents have expired: ${expiredDocNames.join(", ")}`,
          { listingId: id, type: "listing_expired" }
        );
      }

      // Send 7-Day Warning Notifications
      if (expiringSoonDocNames.length > 0 && leaserId) {
        await sendNotification(
          leaserId.toString(),
          "Urgent: Document Expiring Soon",
          `Documents for your listing "${doc.name}" will expire in 7 days: ${expiringSoonDocNames.join(", ")}. Please update them to keep your listing active.`,
          { listingId: id, type: "listing_warning" }
        );
      }
    }
    // --- END LOGIC ---

    const bookings = await Booking.find({ marketplaceListingId: id })
      .select("dates status")
      .session(session)
      .lean();

    const bookingIds = bookings.map((b) => b._id);
    doc.bookings = bookings;

    const reviews = await Review.find({ bookingId: { $in: bookingIds } })
      .populate("userId", "name email")
      .session(session)
      .lean();

    const averageRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length
        : 0;

    doc.reviews = reviews;
    doc.averageRating = Number(averageRating.toFixed(2));

    const form = await Form.findOne({
      subCategory: doc.subCategory?._id,
      zone: doc.zone?._id,
    })
      .select("setting userDocuments leaserDocuments")
      .session(session)
      .lean();

    if (form) {
      const rawUserDocs: string[] = form.userDocuments || [];
      const rawLeaserDocs: string[] = form.leaserDocuments || [];

      // Fetch both dropdowns in parallel
      const [userDropdown, leaserDropdown] = await Promise.all([
        Dropdown.findOne({ name: "userDocuments" }).session(session).lean(),
        Dropdown.findOne({ name: "leaserDocuments" }).session(session).lean(),
      ]);

      const userDropdownValues = userDropdown?.values || [];
      const leaserDropdownValues = leaserDropdown?.values || [];

      const mapDocs = (keys: string[], dropdownValues: any[]) =>
        keys.map((key) => {
          const match = dropdownValues.find((v: any) => v.value === key);
          return match
            ? {
              value: match.value,
              name: match.name,
              hasExpiry: match.hasExpiry,
              autoApproval: match.autoApproval,
            }
            : { value: key, name: key, hasExpiry: false, autoApproval: false };
        });

      doc.userDocuments = mapDocs(rawUserDocs, userDropdownValues);
      doc.leaserDocuments = mapDocs(rawLeaserDocs, leaserDropdownValues);
    } else {
      doc.userDocuments = [];
      doc.leaserDocuments = [];
    }

    if (form?.setting) {
      const renterCommission = (form.setting.renterCommission?.value || 0) / 100;
      const leaserCommission = (form.setting.leaserCommission?.value || 0) / 100;
      const taxRate = (form.setting.tax || 0) / 100;
      const totalCommissionRate = renterCommission + leaserCommission;
      const adminFee = doc.price * totalCommissionRate;
      const tax = (doc.price + adminFee) * taxRate;

      doc.adminFee = adminFee;
      doc.tax = tax;
    } else {
      doc.adminFee = 0;
      doc.tax = 0;
    }

    // --- FIXED: Do not delete doc.documents ---
    // delete doc.documents; <--- REMOVED this line
    delete doc.languages;
    delete doc.__v;

    if (doc.leaser) {
      delete doc.leaser.documents;
      delete doc.leaser.password;
      delete doc.leaser.otp;
      delete doc.leaser.stripe;
      delete doc.leaser.__v;
    }

    const listingLang = doc.languages?.find((l: any) => l.locale === locale);
    if (listingLang?.translations) {
      doc.description = listingLang.translations.description || doc.description;
    }

    await session.commitTransaction();
    session.endSession();

    sendResponse(res, doc, "Listing fetched successfully", STATUS_CODES.OK);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

// get by id
export const getMarketplaceListingById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const doc = await MarketplaceListing.findById(id)
      .populate({
        path: "subCategory",
        select: "name languages category",
        populate: { path: "category", select: "name" },
      })
      .populate({
        path: "zone",
        select: "name polygons rentalPolicies",
        populate: {
          path: "rentalPolicies"
        },
      })
      .populate("leaser", "name email profilePicture")
      .session(session)
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // --- OPTIMIZED LOGIC: CHECK FOR EXPIRED & 7-DAY REMINDERS ---
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    let needsUpdate = false;

    const expiredDocs = (doc.documents || []).filter(
      (d: any) => d.expiryDate && new Date(d.expiryDate) < now && d.isExpired !== true
    );

    const reminderDocs = (doc.documents || []).filter(
      (d: any) => d.expiryDate &&
        new Date(d.expiryDate) > now &&
        new Date(d.expiryDate) <= sevenDaysLater &&
        d.reminderSent !== true
    );

    if (expiredDocs.length > 0 || reminderDocs.length > 0) {
      needsUpdate = true;
      const leaserId = doc.leaser?._id || doc.leaser;

      // 1. Handle Expirations
      if (expiredDocs.length > 0) {
        const docNames = expiredDocs.map((d: any) => d.name).join(", ");

        await MarketplaceListing.updateOne(
          { _id: id },
          {
            $set: {
              status: "pending",
              "documents.$[elem].isExpired": true
            }
          },
          {
            arrayFilters: [{ "elem.expiryDate": { $lt: now }, "elem.isExpired": { $ne: true } }],
            session
          }
        );

        if (leaserId) {
          await sendNotification(
            leaserId.toString(),
            "Listing Action Required: Document Expired",
            `Your listing "${doc.name}" is now pending because documents have expired: ${docNames}`,
            { listingId: id, type: "listing_expired" }
          );
        }
      }

      // 2. Handle 7-Day Reminders
      if (reminderDocs.length > 0) {
        const docNames = reminderDocs.map((d: any) => d.name).join(", ");

        await MarketplaceListing.updateOne(
          { _id: id },
          {
            $set: { "documents.$[rem].reminderSent": true }
          },
          {
            arrayFilters: [{
              "rem.expiryDate": { $gt: now, $lte: sevenDaysLater },
              "rem.reminderSent": { $ne: true }
            }],
            session
          }
        );

        if (leaserId) {
          await sendNotification(
            leaserId.toString(),
            "Urgent: Document Expiring Soon",
            `Documents for "${doc.name}" expire in 7 days: ${docNames}`,
            { listingId: id, type: "listing_warning" }
          );
        }
      }

      // Sync local 'doc' object so Admin sees updated flags immediately
      doc.documents.forEach((d: any) => {
        const dDate = d.expiryDate ? new Date(d.expiryDate) : null;
        if (dDate) {
          if (dDate < now) {
            d.isExpired = true;
            doc.status = "pending";
          }
          if (dDate > now && dDate <= sevenDaysLater) d.reminderSent = true;
        }
      });
    }
    // --- END OPTIMIZED LOGIC ---

    const zoneId =
      typeof doc.zone === "object" ? (doc.zone as any)._id : doc.zone;

    const form = await Form.findOne({
      subCategory: doc.subCategory?._id || doc.subCategory,
      zone: zoneId,
    })
      .select("userDocuments leaserDocuments setting")
      .session(session)
      .lean();

    if (form) {
      (doc as any).userDocuments = form.userDocuments || [];
      (doc as any).leaserDocuments = form.leaserDocuments || [];

      if (form.setting && doc.price) {
        const renterCommission = form.setting?.renterCommission?.value || 0;
        const leaserCommission = form.setting?.leaserCommission?.value || 0;
        const taxPercent = form.setting?.tax || 0;

        const totalCommissionPercent = renterCommission + leaserCommission;

        const adminFee = doc.price * (totalCommissionPercent / 100);

        const tax = (doc.price + adminFee) * (taxPercent / 100);

        (doc as any).adminFee = adminFee;
        (doc as any).tax = tax;
      } else {
        (doc as any).adminFee = 0;
        (doc as any).tax = 0;
      }
    }

    const subCategoryExists = await SubCategory.exists({
      _id: doc.subCategory,
    }).session(session);

    if (!subCategoryExists) {
      await MarketplaceListing.findByIdAndDelete(id).session(session);

      await session.commitTransaction();
      session.endSession();

      sendResponse(
        res,
        null,
        "Listing not found (references invalid)",
        STATUS_CODES.NOT_FOUND
      );
      return;
    }

    if (Array.isArray(doc.languages)) {
      const match = doc.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        doc.description = match.translations.description || doc.description;
      }
    }
    delete (doc as any).languages;

    const subCategoryObj = doc.subCategory as any;
    if (subCategoryObj && Array.isArray(subCategoryObj.languages)) {
      const match = subCategoryObj.languages.find(
        (l: any) => l.locale === locale
      );
      if (match?.translations) {
        subCategoryObj.name = match.translations.name || subCategoryObj.name;
        subCategoryObj.description =
          match.translations.description || subCategoryObj.description;
      }
      delete subCategoryObj.languages;
    }

    const bookings = await Booking.find({ marketplaceListingId: id })
      .select("_id")
      .session(session)
      .lean();

    const bookingIds = bookings.map((b) => b._id);

    const reviews = await Review.find({ bookingId: { $in: bookingIds } })
      .select("stars")
      .session(session)
      .lean();

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + (r.stars || 0), 0) / totalReviews
        : 0;

    (doc as any).averageRating = averageRating;
    (doc as any).totalReviews = totalReviews;

    await session.commitTransaction();
    session.endSession();

    sendResponse(res, doc, "Listing fetched", STATUS_CODES.OK);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

export const getListingBookedDates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { month } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid listing ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const listing = await MarketplaceListing.findById(id)
      .select("_id priceUnit")
      .lean();

    if (!listing) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Build date range filter based strictly on Month
    let rangeStart: Date;
    let rangeEnd: Date;

    if (month) {
      const [year, mon] = (month as string).split("-");
      rangeStart = new Date(Date.UTC(+year, +mon - 1, 1));
      rangeEnd = new Date(Date.UTC(+year, +mon, 0, 23, 59, 59, 999));
    } else {
      // Default to current month if no month is provided
      const now = new Date();
      rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    }

    const bookings = await Booking.find({
      marketplaceListingId: id,
      status: { $nin: ["request_cancelled", "rejected", "expired"] },
      "dates.checkIn": { $lte: rangeEnd },
      "dates.checkOut": { $gte: rangeStart },
    })
      .select("dates -_id")
      .lean();

    // ================================================================
    // CASE 1: HOUR-BASED — return blocked time slots per date
    // ================================================================
    if (listing.priceUnit === "hour") {
      const blockedSlotsMap: Record<string, { from: string; to: string }[]> = {};

      for (const booking of bookings) {
        const checkIn = new Date(booking.dates.checkIn);
        const checkOut = new Date(booking.dates.checkOut);

        const current = new Date(Date.UTC(
          checkIn.getUTCFullYear(),
          checkIn.getUTCMonth(),
          checkIn.getUTCDate()
        ));

        const checkOutDate = new Date(Date.UTC(
          checkOut.getUTCFullYear(),
          checkOut.getUTCMonth(),
          checkOut.getUTCDate()
        ));

        while (current <= checkOutDate) {
          const dateKey = current.toISOString().split("T")[0];

          const isFirstDay = current.getTime() === new Date(Date.UTC(
            checkIn.getUTCFullYear(),
            checkIn.getUTCMonth(),
            checkIn.getUTCDate()
          )).getTime();

          const isLastDay = current.getTime() === checkOutDate.getTime();

          let fromTime: string;
          let toTime: string;

          if (isFirstDay && isLastDay) {
            // Same day booking
            fromTime = checkIn.toISOString().substring(11, 16);
            toTime = checkOut.toISOString().substring(11, 16);
          } else if (isFirstDay) {
            // First day: from checkIn time to midnight
            fromTime = checkIn.toISOString().substring(11, 16);
            toTime = "23:59";
          } else if (isLastDay) {
            // Last day: from midnight to checkOut time
            fromTime = "00:00";
            toTime = checkOut.toISOString().substring(11, 16);
          } else {
            // Middle days: fully blocked
            fromTime = "00:00";
            toTime = "23:59";
          }

          if (!blockedSlotsMap[dateKey]) {
            blockedSlotsMap[dateKey] = [];
          }

          blockedSlotsMap[dateKey].push({ from: fromTime, to: toTime });

          current.setUTCDate(current.getUTCDate() + 1);
        }
      }

      const blockedSlots = Object.entries(blockedSlotsMap).map(
        ([date, slots]) => ({ date, slots })
      );

      const fullyBlockedDates = blockedSlots
        .filter((entry) =>
          entry.slots.some((s) => s.from === "00:00" && s.to === "23:59")
        )
        .map((entry) => entry.date);

      sendResponse(
        res,
        {
          listingId: id,
          priceUnit: "hour",
          blockedSlots,
          fullyBlockedDates,
          totalBlockedSlots: blockedSlots.length,
          range: {
            from: rangeStart.toISOString().split("T")[0],
            to: rangeEnd.toISOString().split("T")[0],
          },
        },
        "Booked slots fetched successfully",
        STATUS_CODES.OK
      );
      return;
    }

    // ================================================================
    // CASE 2: DAY / MONTH / YEAR — return blocked dates
    // ================================================================
    const blockedDates: string[] = [];

    for (const booking of bookings) {
      const start = new Date(Math.max(new Date(booking.dates.checkIn).getTime(), rangeStart.getTime()));
      const end = new Date(Math.min(new Date(booking.dates.checkOut).getTime(), rangeEnd.getTime()));

      const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

      while (current <= end) {
        blockedDates.push(current.toISOString().split("T")[0]);
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }

    const uniqueBlockedDates = [...new Set(blockedDates)].sort();

    sendResponse(
      res,
      {
        listingId: id,
        priceUnit: listing.priceUnit,
        blockedDates: uniqueBlockedDates,
        totalBlockedDates: uniqueBlockedDates.length,
        range: {
          from: rangeStart.toISOString().split("T")[0],
          to: rangeEnd.toISOString().split("T")[0],
        },
      },
      "Booked dates fetched successfully",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// Additional utility function to clean up all orphaned listings
export const cleanupAllOrphanedListings = async (
  req: Request,
  res: Response
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const allListings = await MarketplaceListing.find().session(session);
    let deletedCount = 0;

    for (const listing of allListings) {
      // Use type assertion for listing._id
      const listingId = listing._id as mongoose.Types.ObjectId;

      const zoneExists = await Zone.exists({ _id: listing.zone }).session(
        session
      );
      const subCategoryExists = await SubCategory.exists({
        _id: listing.subCategory,
      }).session(session);

      if (!zoneExists || !subCategoryExists) {
        await MarketplaceListing.findByIdAndDelete(listingId).session(session);
        deletedCount++;
        console.log(`Deleted orphaned listing: ${listingId}`);
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} orphaned listings`,
      deletedCount,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error cleaning up orphaned listings:", error);
    res.status(500).json({
      success: false,
      message: "Error cleaning up orphaned listings",
    });
  }
};

// GET all bookings for a listing
export const getBookingsForListing = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        "Invalid listing ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const listing = await MarketplaceListing.findById(id).lean();
    if (!listing) {
      return sendResponse(
        res,
        null,
        "Listing not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    const bookings = await Booking.find({ marketplaceListingId: id })
      .populate("renter", "name email profilePicture")
      .populate("leaser", "name email")
      .sort({ createdAt: -1 })
      .lean();

    return sendResponse(
      res,
      { listing, bookings },
      "Bookings for listing fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// UPDATE LISTING
export const updateMarketplaceListing = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const existingListing = await MarketplaceListing.findById(id);
    if (!existingListing) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Authorization: Only the owner can update
    if (String(existingListing.leaser) !== String(req.user?.id)) {
      sendResponse(res, null, "Forbidden: You are not the owner", STATUS_CODES.FORBIDDEN);
      return;
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const newImages: string[] = [];
    const newRentalImages: string[] = [];
    const updatedListingDocs: any[] = [...(existingListing.documents || [])];

    // 1. Handle General Images
    if (files?.images) {
      newImages.push(...files.images.map((file) => `/uploads/${file.filename}`));
    }

    // 2. Handle Rental Images
    if (files?.rentalImages) {
      newRentalImages.push(...files.rentalImages.map((file) => `/uploads/${file.filename}`));
    }

    // 3. --- CRITICAL: Handle Legal Documents Update & Reset ---
    // Look for any file fields that are NOT images or rentalImages
    if (files) {
      for (const fieldName of Object.keys(files)) {
        if (fieldName !== "images" && fieldName !== "rentalImages") {
          const file = files[fieldName][0];
          const filePath = `/uploads/${file.filename}`;

          // Get the new expiry date from the body (e.g., qatar_id_expiry)
          const expiryKey = `${fieldName}_expiry`;
          const rawExpiry = req.body[expiryKey];
          const expiryDate = rawExpiry ? new Date(rawExpiry) : undefined;

          // Find if this document already exists in the array
          const docIndex = updatedListingDocs.findIndex((d) => d.name === fieldName);

          const docData = {
            name: fieldName,
            fileUrl: filePath,
            expiryDate: expiryDate,
            isExpired: false,    // RESET: Always false on new upload
            reminderSent: false  // RESET: Always false on new upload
          };

          if (docIndex > -1) {
            updatedListingDocs[docIndex] = docData; // Update existing
          } else {
            updatedListingDocs.push(docData); // Add new
          }
        }
      }
    }

    // 4. Update individual expiry dates even if file didn't change
    // (In case leaser only updated the date text)
    updatedListingDocs.forEach((d) => {
      const expiryKey = `${d.name}_expiry`;
      if (req.body[expiryKey]) {
        d.expiryDate = new Date(req.body[expiryKey]);
        d.isExpired = false;    // Reset because date changed
        d.reminderSent = false; // Reset because date changed
      }
    });

    // Manual validation for required text fields
    const required = ["name", "subTitle", "price"];
    for (const field of required) {
      if (field in req.body && !req.body[field]) {
        res.status(400).json({ success: false, message: `${field} is required` });
        return
      }
    }

    // Filter body for allowed fields
    const allowedUpdates = Object.keys(existingListing.toObject());
    const filteredBody: any = {};
    for (const key of Object.keys(req.body)) {
      if (allowedUpdates.includes(key)) {
        filteredBody[key] = req.body[key];
      }
    }

    // 5. Final Update Object
    const updatedFields = {
      ...filteredBody,
      documents: updatedListingDocs, // Save the RESET documents
      images: newImages.length > 0 ? newImages : existingListing.images,
      rentalImages: newRentalImages.length > 0
        ? [...(existingListing.rentalImages || []), ...newRentalImages]
        : existingListing.rentalImages,
      status: "pending" // Always set to pending for Admin review after update
    };

    const updatedListing = await MarketplaceListing.findByIdAndUpdate(
      id,
      { $set: updatedFields },
      { new: true }
    );

    sendResponse(res, updatedListing, "Listing updated and sent for review", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// DELETE
export const deleteMarketplaceListing = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const existingListing = await MarketplaceListing.findById(id);
    if (!existingListing) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (String(existingListing.leaser) !== String(req.user?.id) && req.user?.role !== "admin") {
      sendResponse(
        res,
        null,
        "Forbidden: You are not the owner",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    await FavouriteCheck.deleteMany({ listing: id });

    await existingListing.deleteOne();

    sendResponse(
      res,
      existingListing,
      "Listing, related favourites deleted",
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

//Search
export const searchMarketplaceListings = async (
  req: Request,
  res: Response
) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ message: "Name query is required" });
    }

    // Normalize input: lowercase + remove spaces
    const normalizedSearch = (name as string).toLowerCase().replace(/\s+/g, "");

    const results = await MarketplaceListing.aggregate([
      {
        $addFields: {
          normalizedName: {
            $replaceAll: {
              input: { $toLower: "$name" },
              find: " ",
              replacement: "",
            },
          },
        },
      },
      {
        $match: {
          normalizedName: { $regex: normalizedSearch, $options: "i" },
        },
      },
      {
        $project: {
          normalizedName: 0,
        },
      },
    ]);

    res.json({ count: results.length, data: results });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

export const getPopularMarketplaceListings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const { zone, subCategory, category } = req.query;

    const filter: any = {};

    filter.status = "approved";

    if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
      filter.zone = new mongoose.Types.ObjectId(String(zone));
    }

    if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
      filter.subCategory = new mongoose.Types.ObjectId(String(subCategory));
    }

    if (category && mongoose.Types.ObjectId.isValid(String(category))) {
      const subCategoryIds = await SubCategory.find({
        category: category,
      }).distinct("_id");
      filter.subCategory = { $in: subCategoryIds };
    }

    const pipeline: any[] = [
      { $match: filter },
      {
        $lookup: {
          from: "categories",
          localField: "subCategory",
          foreignField: "_id",
          as: "subCategory",
        },
      },
      { $unwind: "$subCategory" },
      {
        $lookup: {
          from: "users",
          localField: "leaser",
          foreignField: "_id",
          as: "leaser",
        },
      },
      { $unwind: "$leaser" },
      {
        $lookup: {
          from: "zones",
          localField: "zone",
          foreignField: "_id",
          as: "zone",
        },
      },
      { $unwind: "$zone" },
      {
        $lookup: {
          from: "bookings",
          localField: "_id",
          foreignField: "marketplaceListingId",
          as: "bookings",
        },
      },
      {
        $lookup: {
          from: "reviews",
          localField: "bookings._id",
          foreignField: "bookingId",
          as: "reviews",
        },
      },
      {
        $addFields: {
          averageRating: { $avg: "$reviews.stars" },
          totalReviews: { $size: "$reviews" },
        },
      },

      /* ---------------- FORM LOOKUP ---------------- */
      {
        $lookup: {
          from: "forms",
          let: { subCatId: "$subCategory._id", zoneId: "$zone._id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$subCategory", "$$subCatId"] },
                    { $eq: ["$zone", "$$zoneId"] },
                  ],
                },
              },
            },
            {
              $project: {
                setting: 1,
                userDocuments: 1,
                leaserDocuments: 1,
              },
            },
          ],
          as: "form",
        },
      },

      /* ---------------- ADD DOCUMENTS FIELDS ---------------- */
      {
        $addFields: {
          userDocuments: {
            $ifNull: [{ $arrayElemAt: ["$form.userDocuments", 0] }, []],
          },
          leaserDocuments: {
            $ifNull: [{ $arrayElemAt: ["$form.leaserDocuments", 0] }, []],
          },
        },
      },

      /* ---------------- CLEANUP ---------------- */
      { $project: { form: 0 } },

      { $sort: { averageRating: -1, totalReviews: -1 } },
      { $limit: 20 },
    ];

    const listings = await MarketplaceListing.aggregate(pipeline).session(
      session
    );

    const final = listings.map((obj: any) => {
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description =
          listingLang.translations.description || obj.description;
      }
      delete obj.languages;
      return obj;
    });

    await session.commitTransaction();
    session.endSession();

    sendResponse(
      res,
      { popularListings: final, total: final.length },
      `Fetched top ${final.length} popular listings`,
      STATUS_CODES.OK
    );
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};