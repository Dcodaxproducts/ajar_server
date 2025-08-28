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
export const createMarketplaceListing = async (req: any, res: Response) => {
  try {
    const { zone, subCategory } = req.body;
    const leaser = req.user.id;

    // 1. Get Form for zone + subCategory
    const form = await Form.findOne({
      zone: zone,
      subCategory: subCategory,
    }).populate("fields");

    if (!form) {
      return res.status(400).json({
        success: false,
        message: "Form not found for this Zone and SubCategory",
      });
    }

    // 👇 Cast to IField[]
    const fields = form.fields as unknown as IField[];
    const requestData: any = {};

    // 2. Validate dynamically
    for (const field of fields) {
      const value = req.body[field.name];

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

        requestData[field.name] = value;
      }
    }

    // 3. Handle uploaded files with full URL
    if (req.files) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;

      for (const field of fields) {
        if (field.type === "file" && req.files[field.name]) {
          requestData[field.name] = (
            req.files[field.name] as Express.Multer.File[]
          ).map((file) => `${baseUrl}/uploads/${file.filename}`);
        }
      }

      if (req.files["images"]) {
        requestData.images = (req.files["images"] as Express.Multer.File[]).map(
          (file) => `${baseUrl}/uploads/${file.filename}`
        );
      }

      if (req.files["rentalImages"]) {
        requestData.rentalImages = (
          req.files["rentalImages"] as Express.Multer.File[]
        ).map((file) => `${baseUrl}/uploads/${file.filename}`);
      }
    }

    // 4. Save listing
    const listing = new MarketplaceListing({
      leaser,
      zone,
      subCategory,
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

// Get All Marketplace Listings
export const getAllMarketplaceListings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const { page = 1, limit = 10, zone, subCategory, all } = req.query;

    const filter: any = {};

    // ------------------ UPDATED LOGIC ------------------
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

    const baseQuery = MarketplaceListing.find(filter)
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

    const uniqueUserIds = await MarketplaceListing.distinct("leaser", filter);
    const totalUsersWithListings = uniqueUserIds.length;
    const totalMarketplaceListings = await MarketplaceListing.countDocuments(
      filter
    );

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
    next(err);
  }
};

// READ ONE BY ID
export const getMarketplaceListingById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const doc = await MarketplaceListing.findById(id)
      .populate("subCategory")
      .populate("zone")
      .populate("leaser", "name _id")
      .lean();

    if (!doc) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
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

    sendResponse(res, doc, "Listing fetched", STATUS_CODES.OK);
  } catch (err) {
    next(err);
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
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    let newImages: string[] = [];
    let newRentalImages: string[] = [];

    if (files?.images) {
      newImages = files.images.map(
        (file) => `${baseUrl}/uploads/${file.filename}`
      );
    }

    if (files?.rentalImages) {
      newRentalImages = files.rentalImages.map(
        (file) => `${baseUrl}/uploads/${file.filename}`
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

    await existingListing.deleteOne();
    sendResponse(res, existingListing, "Listing deleted", STATUS_CODES.OK);
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
