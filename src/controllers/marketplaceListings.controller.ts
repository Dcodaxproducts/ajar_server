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

// controllers/marketplaceListings.controller.ts
// export const createMarketplaceListing = async (req: any, res: Response) => {
//   try {
//     const { zone, subCategory } = req.body;
//     const leaser = req.user.id;

//     // 1. Get Form for zone + subCategory
//     const form = await Form.findOne({
//       zone: zone,
//       subCategory: subCategory,
//     }).populate("fields");

//     if (!form) {
//       return res.status(400).json({
//         success: false,
//         message: "Form not found for this Zone and SubCategory",
//       });
//     }

//     // Cast to IField[]
//     const fields = form.fields as unknown as IField[];
//     const requestData: any = {};

//     // 2. Validate dynamically
//     for (const field of fields) {
//       const value = req.body[field.name];

//       if (field.validation?.required && (value === undefined || value === "")) {
//         return res
//           .status(400)
//           .json({ success: false, message: `${field.label} is required` });
//       }

//       if (value !== undefined) {
//         if (field.options?.length && !field.options.includes(value)) {
//           return res.status(400).json({
//             success: false,
//             message: `${field.label} must be one of: ${field.options.join(
//               ", "
//             )}`,
//           });
//         }

//         if (field.min !== undefined && value < field.min) {
//           return res.status(400).json({
//             success: false,
//             message: `${field.label} must be >= ${field.min}`,
//           });
//         }

//         if (field.max !== undefined && value > field.max) {
//           return res.status(400).json({
//             success: false,
//             message: `${field.label} must be <= ${field.max}`,
//           });
//         }

//         if (field.validation?.pattern) {
//           const regex = new RegExp(field.validation.pattern);
//           if (!regex.test(value)) {
//             return res.status(400).json({
//               success: false,
//               message: `${field.label} format is invalid`,
//             });
//           }
//         }

//         requestData[field.name] = value;
//       }
//     }

//     // 3. Extra manual validation for required fields
//     if (!req.body.name) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Name is required" });
//     }
//     if (!req.body.subTitle) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Subtitle is required" });
//     }
//     if (!req.body.price) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Price is required" });
//     }
//     if (!req.files?.rentalImages) {
//       return res.status(400).json({
//         success: false,
//         message: "At least one rental image is required",
//       });
//     }

//     // 3. Handle uploaded files with full URL
//     if (req.files) {
//       const baseUrl = `${req.protocol}://${req.get("host")}`;

//       for (const field of fields) {
//         if (field.type === "file" && req.files[field.name]) {
//           requestData[field.name] = (
//             req.files[field.name] as Express.Multer.File[]
//           ).map((file) => `/uploads/${file.filename}`);
//         }
//       }

//       if (req.files["images"]) {
//         requestData.images = (req.files["images"] as Express.Multer.File[]).map(
//           (file) => `/uploads/${file.filename}`
//         );
//       }

//       if (req.files["rentalImages"]) {
//         requestData.rentalImages = (
//           req.files["rentalImages"] as Express.Multer.File[]
//         ).map((file) => `/uploads/${file.filename}`);
//       }
//     }

//     // 4. Save listing
//     const listing = new MarketplaceListing({
//       leaser,
//       zone,
//       subCategory,
//       name: req.body.name,
//       subTitle: req.body.subTitle,
//       price: req.body.price,
//       ...requestData,
//     });

//     await listing.save();

//     return res.status(201).json({ success: true, data: listing });
//   } catch (error) {
//     console.error(error);
//     return res
//       .status(500)
//       .json({ success: false, message: "Server error", error });
//   }
// };

//Utility to convert keys to camelCase
const toCamelCase = (str: string) => {
  return str
    .replace(/([-_][a-z])/gi, (s) =>
      s.toUpperCase().replace("-", "").replace("_", "")
    )
    .replace(/^[A-Z]/, (s) => s.toLowerCase());
};

export const createMarketplaceListing = async (req: any, res: Response) => {
  try {
    const { zone, subCategory } = req.body;
    const leaser = req.user.id;

    // 🔹 Normalise all incoming keys to camelCase
    const normalisedBody: any = {};
    for (const key of Object.keys(req.body)) {
      normalisedBody[toCamelCase(key)] = req.body[key];
    }

    // 1. Fetch form for zone + subCategory
    const form = await Form.findOne({ zone, subCategory }).populate("fields");
    if (!form) {
      return res.status(400).json({
        success: false,
        message: "Form not found for this Zone and SubCategory",
      });
    }

    const fields = form.fields as unknown as IField[];
    const requestData: any = {};

    // 2. Dynamic validation from form fields
    for (const field of fields) {
      const fieldName = toCamelCase(field.name); // enforce camelCase
      const value = normalisedBody[fieldName];

      if (field.validation?.required && (value === undefined || value === "")) {
        return res
          .status(400)
          .json({ success: false, message: `${field.label} is required` });
      }

      if (value !== undefined) {
        if (field.options?.length && !field.options.includes(value)) {
          return res.status(400).json({
            success: false,
            message: `${field.label} must be one of: ${field.options.join(
              ", "
            )}`,
          });
        }

        if (field.min !== undefined && value < field.min) {
          return res.status(400).json({
            success: false,
            message: `${field.label} must be >= ${field.min}`,
          });
        }

        if (field.max !== undefined && value > field.max) {
          return res.status(400).json({
            success: false,
            message: `${field.label} must be <= ${field.max}`,
          });
        }

        if (field.validation?.pattern) {
          const regex = new RegExp(field.validation.pattern);
          if (!regex.test(value)) {
            return res.status(400).json({
              success: false,
              message: `${field.label} format is invalid`,
            });
          }
        }

        requestData[fieldName] = value;
      }
    }

    // 3. Manual validation for must-have fields
    if (!normalisedBody.name) {
      return res
        .status(400)
        .json({ success: false, message: "name is required" });
    }
    if (!normalisedBody.subTitle) {
      return res
        .status(400)
        .json({ success: false, message: "subTitle is required" });
    }
    if (!normalisedBody.price) {
      return res
        .status(400)
        .json({ success: false, message: "price is required" });
    }
    if (!req.files || !req.files.rentalImages) {
      return res
        .status(400)
        .json({ success: false, message: "rentalImages is required" });
    }

    // 4. Handle uploaded files
    if (req.files) {
      for (const field of fields) {
        const fieldName = toCamelCase(field.name);
        if (field.type === "file" && req.files[fieldName]) {
          requestData[fieldName] = (
            req.files[fieldName] as Express.Multer.File[]
          ).map((file) => `/uploads/${file.filename}`);
        }
      }

      if (req.files["images"]) {
        requestData.images = (req.files["images"] as Express.Multer.File[]).map(
          (file) => `/uploads/${file.filename}`
        );
      }

      if (req.files["rentalImages"]) {
        requestData.rentalImages = (
          req.files["rentalImages"] as Express.Multer.File[]
        ).map((file) => `/uploads/${file.filename}`);
      }
    }

    // 5. Save listing
    const listing = new MarketplaceListing({
      leaser,
      zone,
      subCategory,
      name: normalisedBody.name,
      subTitle: normalisedBody.subTitle,
      price: normalisedBody.price,
      ...requestData,
    });

    await listing.save();

    return res.status(201).json({ success: true, data: listing });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error });
  }
};

// Get All Marketplace Listings with automatic cleanup
export const getAllMarketplaceListings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const { page = 1, limit = 10, zone, subCategory, all } = req.query;

    const filter: any = {};

    if (req.user) {
      if (req.user.role === "admin") {
        // Admin → show all listings, optionally filter by zone
        if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
          filter.zone = zone;
        }
      } else {
        // Normal user
        if (all === "true") {
          // Show all listings → don't filter by leaser, only zone/subCategory
          if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
            filter.zone = zone;
          }
        } else {
          // Default → only user's own listings
          filter.leaser = req.user.id;
          if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
            filter.zone = zone;
          }
        }
      }
    } else {
      // Guest user (no token) → all listings, optionally filter by zone
      if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
        filter.zone = zone;
      }
    }

    if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
      filter.subCategory = subCategory;
    }

    // First, find all listings that match the filter
    const allListings = await MarketplaceListing.find(filter).session(session);

    // Check each listing for valid references and collect invalid ones
    const invalidListingIds: mongoose.Types.ObjectId[] = [];
    const validListings: any[] = [];

    for (const listing of allListings) {
      // Use type assertion for listing._id
      const listingId = listing._id as mongoose.Types.ObjectId;

      const zoneExists = await Zone.exists({ _id: listing.zone }).session(
        session
      );
      const subCategoryExists = await SubCategory.exists({
        _id: listing.subCategory,
      }).session(session);

      if (zoneExists && subCategoryExists) {
        validListings.push(listing);
      } else {
        invalidListingIds.push(listingId);
        console.log(
          `Marking listing ${listingId} for deletion - missing references`
        );
      }
    }

    // Delete invalid listings
    if (invalidListingIds.length > 0) {
      await MarketplaceListing.deleteMany({
        _id: { $in: invalidListingIds },
      }).session(session);
      console.log(
        `Deleted ${invalidListingIds.length} invalid listings with missing references`
      );
    }

    // Now paginate only the valid listings
    const baseQuery = MarketplaceListing.find({
      ...filter,
      _id: { $in: validListings.map((l) => l._id as mongoose.Types.ObjectId) },
    })
      .populate("leaser", "_id name profilePicture phone createdAt updatedAt")
      .populate("subCategory", "_id name thumbnail createdAt updatedAt");

    const { data, total } = await paginateQuery(baseQuery, {
      page: +page,
      limit: +limit,
    });

    const final = data.map((doc: any) => {
      const obj = doc.toObject();
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description =
          listingLang.translations.description || obj.description;
      }
      delete obj.languages;
      return obj;
    });

    const uniqueUserIds = await MarketplaceListing.distinct("leaser", {
      ...filter,
      _id: { $in: validListings.map((l) => l._id as mongoose.Types.ObjectId) },
    }).session(session);

    const totalUsersWithListings = uniqueUserIds.length;
    const totalMarketplaceListings = validListings.length;

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
        totalMarketplaceListings,
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

// READ ONE BY ID with automatic cleanup
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
      .populate("subCategory")
      .populate("zone")
      .populate("leaser", "name _id")
      .session(session)
      .lean();

    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Check if referenced documents exist
    const zoneExists = await Zone.exists({ _id: doc.zone }).session(session);
    const subCategoryExists = await SubCategory.exists({
      _id: doc.subCategory,
    }).session(session);

    if (!zoneExists || !subCategoryExists) {
      // Delete the listing since references are invalid
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

// Get All Marketplace Listings
// export const getAllMarketplaceListings = async (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
//     const { page = 1, limit = 10, zone, subCategory, all } = req.query;

//     const filter: any = {};

//     if (req.user) {
//       if (req.user.role === "admin") {
//         // Admin → show all listings, optionally filter by zone
//         if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
//           filter.zone = zone;
//         }
//       } else {
//         // Normal user
//         if (all === "true") {
//           // Show all listings → don't filter by leaser, only zone/subCategory
//           if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
//             filter.zone = zone;
//           }
//         } else {
//           // Default → only user's own listings
//           filter.leaser = req.user.id;
//           if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
//             filter.zone = zone;
//           }
//         }
//       }
//     } else {
//       // Guest user (no token) → all listings, optionally filter by zone
//       if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
//         filter.zone = zone;
//       }
//     }

//     if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
//       filter.subCategory = subCategory;
//     }

//     const baseQuery = MarketplaceListing.find(filter)
//       .populate("leaser", "_id name profilePicture phone createdAt updatedAt")
//       .populate("subCategory", "_id name thumbnail createdAt updatedAt");

//     const { data, total } = await paginateQuery(baseQuery, {
//       page: +page,
//       limit: +limit,
//     });

//     const final = data.map((doc: any) => {
//       const obj = doc.toObject();
//       const listingLang = obj.languages?.find((l: any) => l.locale === locale);
//       if (listingLang?.translations) {
//         obj.description =
//           listingLang.translations.description || obj.description;
//       }
//       delete obj.languages;
//       return obj;
//     });

//     const uniqueUserIds = await MarketplaceListing.distinct("leaser", filter);
//     const totalUsersWithListings = uniqueUserIds.length;
//     const totalMarketplaceListings = await MarketplaceListing.countDocuments(
//       filter
//     );

//     sendResponse(
//       res,
//       {
//         listings: final,
//         total,
//         page: +page,
//         limit: +limit,
//         totalUsersWithListings,
//         totalMarketplaceListings,
//       },
//       `Fetched listings${locale !== "en" ? ` (locale: ${locale})` : ""}`,
//       STATUS_CODES.OK
//     );
//   } catch (err) {
//     next(err);
//   }
// };

// // // READ ONE BY ID
// export const getMarketplaceListingById = async (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
//       return;
//     }

//     const doc = await MarketplaceListing.findById(id)
//       .populate("subCategory")
//       .populate("zone")
//       .populate("leaser", "name _id")
//       .lean();

//     if (!doc) {
//       sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
//       return;
//     }

//     if (Array.isArray(doc.languages)) {
//       const match = doc.languages.find((l: any) => l.locale === locale);
//       if (match?.translations) {
//         doc.description = match.translations.description || doc.description;
//       }
//     }
//     delete (doc as any).languages;

//     const subCategoryObj = doc.subCategory as any;
//     if (subCategoryObj && Array.isArray(subCategoryObj.languages)) {
//       const match = subCategoryObj.languages.find(
//         (l: any) => l.locale === locale
//       );
//       if (match?.translations) {
//         subCategoryObj.name = match.translations.name || subCategoryObj.name;
//         subCategoryObj.description =
//           match.translations.description || subCategoryObj.description;
//       }
//       delete subCategoryObj.languages;
//     }

//     sendResponse(res, doc, "Listing fetched", STATUS_CODES.OK);
//   } catch (err) {
//     next(err);
//   }
// };

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
    const baseUrl = `${req.protocol}://${req.get("host")}`;

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

    const updatedFields = {
      ...req.body,
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
          normalizedName: 0, // remove helper field from output
        },
      },
    ]);

    res.json({ count: results.length, data: results });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};
