import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { paginateQuery } from "../utils/paginate";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Zone } from "../models/zone.model";
import { SubCategory } from "../models/category.model";
import { Form } from "../models/form.model";
import { Field, IField } from "../models/field.model";
import { Booking } from "../models/booking.model";
import { UserDocument } from "../models/userDocs.model";
import { UserForm } from "../models/userForm.model";
import { validateDocuments } from "../middlewares/documentvalidationhelper.middleware";
import { User } from "../models/user.model";
import { Review } from "../models/review.model";
import { sendNotification } from "../utils/notifications";
import { FavouriteCheck } from "../models/favouriteChecks.model";

// controllers/marketplaceListings.controller.ts]
const toCamelCase = (str: string) =>
  str
    .replace(/([-_][a-z])/gi, (s) =>
      s.toUpperCase().replace("-", "").replace("_", "")
    )
    .replace(/^[A-Z]/, (s) => s.toLowerCase());

export const createMarketplaceListing = async (req: any, res: Response) => {
  console.log("Starting createMarketplaceListing process...");
  try {
    const { zone, subCategory } = req.body;
    const leaser = req.user.id;

    console.log(
      `Request received for Zone: ${zone}, SubCategory: ${subCategory}, Leaser ID: ${leaser}`
    );

    // Normalize body keys
    const normalisedBody: any = {};
    for (const key of Object.keys(req.body)) {
      normalisedBody[toCamelCase(key)] = req.body[key];
    }
    console.log("Normalized request body:", normalisedBody);

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

    //ADDED: validate allowed price units
    const validUnits = ["hour", "day", "month", "year"];
    if (!validUnits.includes(normalisedBody.priceUnit)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priceUnit. Allowed: hour, day, month, year",
      });
    }

    // Load Form for zone + subCategory
    const form = await Form.findOne({
      zone: new mongoose.Types.ObjectId(zone),
      subCategory: new mongoose.Types.ObjectId(subCategory),
    }).populate("fields");

    if (!form) {
      console.log("Form not found for specified Zone/SubCategory.");
      return res.status(400).json({
        success: false,
        message: "Form not found for this Zone/SubCategory",
      });
    }
    console.log("Form found:", (form as any).name);

    // Handle uploaded files and separate them
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const generalImages: string[] = [];
    const rentalImages: string[] = [];
    const listingDocs: any[] = [];

    const requiredDocs = (form as any).leaserDocuments || [];
    const uploadedDocNames = uploadedFiles.map((file) => file.fieldname);
    console.log("Required documents from Form:", requiredDocs);
    console.log("Uploaded file field names:", uploadedDocNames);
    console.log("Incoming files:", req.files);

    // Check for required rentalImages
    const hasRentalImages = uploadedFiles.some(
      (file) => file.fieldname === "rentalImages"
    );
    if (!hasRentalImages) {
      console.log("Missing required file: rentalImages");
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
        console.log("Missing required documents:", missingDocs);
        return res.status(400).json({
          success: false,
          message: `Missing required document(s): ${missingDocs.join(", ")}`,
          missingDocuments: missingDocs,
        });
      }
    }

    // Separate images and documents
    uploadedFiles.forEach((file) => {
      const filePath = `/uploads/${file.filename}`;
      if (file.fieldname === "images") {
        generalImages.push(filePath);
      } else if (file.fieldname === "rentalImages") {
        rentalImages.push(filePath);
      } else {
        listingDocs.push({
          name: file.fieldname,
          filesUrl: [filePath],
        });
      }
    });

    console.log("General Images:", generalImages);
    console.log("Rental Images:", rentalImages);
    console.log("Listing Documents:", listingDocs);

    // Validate dynamic fields from form
    console.log("Starting validation of dynamic fields...");
    const fields = (form as any).fields as any[];
    const requestData: any = {};

    for (const field of fields) {
      const fieldName = toCamelCase(field.name);
      const value = normalisedBody[fieldName];

      // Skip document-type fields (file uploads handled above)
      if (field.type === "document") {
        console.log(`Skipping validation for document-type field: ${fieldName}`);
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

    console.log("Dynamic fields validated successfully.");

    // Create Marketplace Listing with separated data
    console.log("Creating new Marketplace Listing...");
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
          `Leaser ${req.user.name || req.user.email || "A user"} has created a new listing: ${listing.name}`,
          // { listingId: listing._id.toString(), type: "listing" }
          { listingId: (listing._id as mongoose.Types.ObjectId).toString(), type: "listing" }

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
    const { status } = req.body;

    // Only allow valid statuses
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Allowed values: approved, rejected",
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
    await listing.save();

    // Notify leaser about status update
    try {
      await sendNotification(
        listing.leaser.toString(),
        `Listing ${status}`,
        `Your listing "${listing.name}" has been ${status}`,
        // { listingId: listing._id.toString(), status, type: "listing" }
         { listingId: (listing._id as mongoose.Types.ObjectId).toString(), status, type: "listing" }
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

    //ROLE-BASED FILTERS
    if (req.user) {
      if (req.user.role === "admin") {
        if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
          filter.zone = new mongoose.Types.ObjectId(String(zone));
        }
      } else {
        if (all === "true") {
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
      if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
        filter.zone = new mongoose.Types.ObjectId(String(zone));
      }
    }

    //CATEGORY & SUBCATEGORY FILTERS
    if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
      filter.subCategory = new mongoose.Types.ObjectId(String(subCategory));
    }

    if (category && mongoose.Types.ObjectId.isValid(String(category))) {
      const subCategoryIds = await SubCategory.find({
        category: category,
      }).distinct("_id");

      filter.subCategory = { $in: subCategoryIds };
    }

    //AGGREGATION PIPELINE
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

      // Lookup all bookings for each listing
      {
        $lookup: {
          from: "bookings",
          localField: "_id",
          foreignField: "marketplaceListingId",
          as: "bookings",
        },
      },

      //Lookup reviews for those bookings
      {
        $lookup: {
          from: "reviews",
          localField: "bookings._id",
          foreignField: "bookingId",
          as: "reviews",
        },
      },

      //Calculate average rating & total reviews
      {
        $addFields: {
          averageRating: { $avg: "$reviews.stars" },
          totalReviews: { $size: "$reviews" },
        },
      },

      //Lookup Form based on subCategory + zone
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
          userDocuments: {
            $ifNull: [{ $arrayElemAt: ["$form.userDocuments", 0] }, []],
          },
          leaserDocuments: {
            $ifNull: [{ $arrayElemAt: ["$form.leaserDocuments", 0] }, []],
          },
        },
      },
      { $project: { form: 0, documents: 0 } },

      // Sort by recent if requested
      ...(recent === "true" ? [{ $sort: { createdAt: -1 } }] : []),

      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) },
    ];

    const listings = await MarketplaceListing.aggregate(pipeline).session(
      session
    );
    const total = await MarketplaceListing.countDocuments(filter).session(
      session
    );

    //LANGUAGE HANDLING
    const final = listings.map((obj: any) => {
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description =
          listingLang.translations.description || obj.description;
      }
      delete obj.languages;
      return obj;
    });

    //STATS
    const uniqueUserIds = await MarketplaceListing.distinct(
      "leaser",
      filter
    ).session(session);
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

      { $lookup: { from: "categories", localField: "subCategory", foreignField: "_id", as: "subCategory" } },
      { $unwind: "$subCategory" },

      { $lookup: { from: "users", localField: "leaser", foreignField: "_id", as: "leaser" } },
      { $unwind: "$leaser" },

      { $lookup: { from: "zones", localField: "zone", foreignField: "_id", as: "zone" } },
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

    const listings = await MarketplaceListing.aggregate(pipeline).session(session);
    const total = await MarketplaceListing.countDocuments(filter).session(session);

    /* ---------------- LANGUAGE HANDLING ---------------- */
    const final = listings.map((obj: any) => {
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description = listingLang.translations.description || obj.description;
      }
      delete obj.languages;
      return obj;
    });

    const uniqueUserIds = await MarketplaceListing.distinct("leaser", filter).session(session);

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
      .populate({ path: "subCategory", populate: { path: "category" } })
      .populate("leaser")
      .populate("zone") 
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const bookings = await Booking.find({ marketplaceListingId: id }).select("_id");
    const bookingIds = bookings.map((b) => b._id);

    const reviews = await Review.find({ bookingId: { $in: bookingIds } })
      .populate("userId", "name email")
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
      doc.userDocuments = form.userDocuments || [];
      doc.leaserDocuments = form.leaserDocuments || [];
    } else {
      doc.userDocuments = [];
      doc.leaserDocuments = [];
    }

    if (form?.setting) {
      const renterCommission =
        (form.setting.renterCommission?.value || 0) / 100;
      const leaserCommission =
        (form.setting.leaserCommission?.value || 0) / 100;
      const taxRate = (form.setting.tax || 0) / 100;

      const totalCommissionRate = renterCommission + leaserCommission;

      const adminFee = doc.price * totalCommissionRate;
      const tax = (doc.price + adminFee) * taxRate;

      doc.adminFee = Number(adminFee.toFixed(2));
      doc.tax = Number(tax.toFixed(2));
    } else {
      doc.adminFee = 0;
      doc.tax = 0;
    }

    delete doc.documents;
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
        populate: { path: "category" },
      })
      .populate({
    path: "zone",
    select: "name", 
  })
      .populate("leaser")
      .session(session)
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const zoneId =
    typeof doc.zone === "object"
    ? (doc.zone as any)._id
    : doc.zone;

    // const zoneId = doc.zone;

    // remove zone field from final response (unchanged behaviour)
    // delete (doc as any).zone;

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
        const renterCommission =
          form.setting?.renterCommission?.value || 0;
        const leaserCommission =
          form.setting?.leaserCommission?.value || 0;
        const taxPercent = form.setting?.tax || 0;

        const totalCommissionPercent =
          renterCommission + leaserCommission;

        const adminFee =
          doc.price * (totalCommissionPercent / 100);

        const tax =
          (doc.price + adminFee) * (taxPercent / 100);

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
      await MarketplaceListing.findByIdAndDelete(id)
        .session(session);

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
      const match = doc.languages.find(
        (l: any) => l.locale === locale
      );
      if (match?.translations) {
        doc.description =
          match.translations.description || doc.description;
      }
    }
    delete (doc as any).languages;

    const subCategoryObj = doc.subCategory as any;
    if (subCategoryObj && Array.isArray(subCategoryObj.languages)) {
      const match = subCategoryObj.languages.find(
        (l: any) => l.locale === locale
      );
      if (match?.translations) {
        subCategoryObj.name =
          match.translations.name || subCategoryObj.name;
        subCategoryObj.description =
          match.translations.description ||
          subCategoryObj.description;
      }
      delete subCategoryObj.languages;
    }

    await session.commitTransaction();
    session.endSession();

    sendResponse(res, doc, "Listing fetched", STATUS_CODES.OK);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
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

    if (String(existingListing.leaser) !== String(req.user?.id)) {
      sendResponse(
        res,
        null,
        "Forbidden: You are not the owner",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    let newImages: string[] = [];
    let newRentalImages: string[] = [];

    if (files?.images) {
      newImages = files.images.map((file) => `/uploads/${file.filename}`);
    }

    if (files?.rentalImages) {
      newRentalImages = files.rentalImages.map(
        (file) => `/uploads/${file.filename}`
      );
    }

    //Manual validation
    if ("name" in req.body && !req.body.name) {
      res.status(400).json({ success: false, message: "name is required" });
      return;
    }
    if ("subTitle" in req.body && !req.body.subTitle) {
      res.status(400).json({ success: false, message: "subTitle is required" });
      return;
    }
    if ("price" in req.body && !req.body.price) {
      res.status(400).json({ success: false, message: "price is required" });
      return;
    }
    if ("rentalImages" in req.body && !files?.rentalImages) {
      res
        .status(400)
        .json({ success: false, message: "rentalImages is required" });
      return;
    }

    //Only allow updating fields that exist in schema
    const allowedUpdates = Object.keys(existingListing.toObject());
    const filteredBody: any = {};

    for (const key of Object.keys(req.body)) {
      if (allowedUpdates.includes(key)) {
        filteredBody[key] = req.body[key];
      }
    }

    const updatedFields = {
      ...filteredBody,
      images: newImages.length > 0 ? newImages : existingListing.images,
      rentalImages:
        newRentalImages.length > 0
          ? newRentalImages
          : existingListing.rentalImages,
    };

    const updatedListing = await MarketplaceListing.findByIdAndUpdate(
      id,
      updatedFields,
      { new: true }
    );

    sendResponse(res, updatedListing, "Listing updated", STATUS_CODES.OK);
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

    if (String(existingListing.leaser) !== String(req.user?.id)) {
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
