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

    //Early validation for required fields
    const requiredFields = ["name", "subTitle", "price"];
    for (const field of requiredFields) {
      if (!normalisedBody[field]) {
        console.log(`Missing required body field: ${field}`);
        return res.status(400).json({
          success: false,
          message: `${field} is required`,
        });
      }
    }

    //Load Form for zone + subCategory
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
    console.log("Form found:", form.name);

    //Handle uploaded files and separate them
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const generalImages: string[] = [];
    const rentalImages: string[] = [];
    const listingDocs: any[] = [];

    const requiredDocs = form.leaserDocuments || [];
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

    //Check for missing required documents
    if (requiredDocs.length > 0) {
      const missingDocs = requiredDocs.filter(
        (docName) => !uploadedDocNames.includes(docName)
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

    //Separate images and documents
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

    //Validate dynamic fields from form
    console.log("Starting validation of dynamic fields...");
    const fields = form.fields as any[];
    const requestData: any = {};

    for (const field of fields) {
      const fieldName = toCamelCase(field.name);
      const value = normalisedBody[fieldName];

      //CHANGE: Skip validation for document-type fields (handled via file uploads)
      if (field.type === "document") {
        console.log(
          `Skipping validation for document-type field: ${fieldName}`
        );
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

    //Create Marketplace Listing with separated data
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
      ...requestData,
    });

    await listing.save();
    console.log("Listing created successfully with ID:", listing._id);

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

//UPDATED getAllMarketplaceListings — added reviews & average rating
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

      //Calculate average rating
      {
        $addFields: {
          averageRating: { $avg: "$reviews.stars" },
          totalReviews: { $size: "$reviews" },
        },
      },

      // Lookup Form based on subCategory + zone
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
      { $project: { form: 0 } },
      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) },
    ];

    //Sort by recently posted date (createdAt)
    if (recent === "true") {
      pipeline.push({ $sort: { createdAt: -1 } });
    }

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

// UPDATED getMarketplaceListingByIdforLeaser — include all reviews & average rating
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

    const doc = await MarketplaceListing.findById(id)
      .populate({ path: "subCategory", populate: { path: "category" } })
      .populate("leaser")
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    //Fetch all bookings related to this listing
    const bookings = await Booking.find({ marketplaceListingId: id }).select(
      "_id"
    );

    //Fetch all reviews related to those bookings
    const bookingIds = bookings.map((b) => b._id);
    const reviews = await Review.find({ bookingId: { $in: bookingIds } })
      .populate("userId", "name email")
      .lean();

    //Calculate average rating
    const averageRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length
        : 0;

    // Add reviews and average to the response
    (doc as any).reviews = reviews;
    (doc as any).averageRating = Number(averageRating.toFixed(2));

    //Existing cleanup
    delete (doc as any).zone;
    delete (doc as any).documents;
    delete (doc as any).__v;
    delete (doc as any).languages;

    if (doc.leaser) {
      delete (doc.leaser as any).documents;
      delete (doc.leaser as any).password;
      delete (doc.leaser as any).otp;
      delete (doc.leaser as any).stripe;
      delete (doc.leaser as any).__v;
    }

    const form = await Form.findOne({
      subCategory: doc.subCategory?._id || doc.subCategory,
      zone: doc.zone,
    })
      .select("userDocuments leaserDocuments")
      .session(session)
      .lean();

    if (form) {
      (doc as any).userDocuments = form.userDocuments || [];
      (doc as any).leaserDocuments = form.leaserDocuments || [];
    }

    await session.commitTransaction();
    session.endSession();

    sendResponse(res, doc, "Listing fetched with reviews", STATUS_CODES.OK);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

//for admin
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
      .populate("leaser")
      .session(session)
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    //remove zone field from final response
    delete (doc as any).zone;

    //fetch Form to include userDocuments
    const form = await Form.findOne({
      subCategory: doc.subCategory?._id || doc.subCategory,
      zone: doc.zone,
    })
      .select("userDocuments leaserDocuments")
      .session(session)
      .lean();

    if (form) {
      (doc as any).userDocuments = form.userDocuments || [];
      (doc as any).leaserDocuments = form.leaserDocuments || [];
    }

    //Check if referenced subCategory exists
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

    //Translate listing description if locale matches
    if (Array.isArray(doc.languages)) {
      const match = doc.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        doc.description = match.translations.description || doc.description;
      }
    }
    delete (doc as any).languages;

    //Translate subCategory fields if locale matches
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

    // Delete the listing itself
    await existingListing.deleteOne();

    // Cascade delete bookings related to this listing
    await Booking.deleteMany({ marketplaceListingId: id });

    sendResponse(
      res,
      existingListing,
      "Listing and related bookings deleted",
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

// update listing status (admin only)
export const updateListingStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { listingId } = req.params;
    const { status } = req.body;

    //Only allow valid statuses
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Allowed values: approved, rejected",
      });
    }

    //Find listing and update status
    const listing = await MarketplaceListing.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: "Listing not found",
      });
    }

    listing.status = status;
    await listing.save();

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
