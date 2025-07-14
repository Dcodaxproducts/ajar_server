import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { paginateQuery } from "../utils/paginate";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Zone } from "../models/zone.model";
import { SubCategory } from "../models/category.model";

// CREATE
export const createMarketplaceListing = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      subCategory,
      zone,
      fields,
      ratings,
      description,
      currency,
      price,
      language = "en",
      languages,
    } = req.body;

    // Validate required fields
    if (!subCategory || !zone) {
      sendResponse(res, null, "`subCategory` and `zone` are required", STATUS_CODES.BAD_REQUEST);
      return;
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      sendResponse(res, null, "`fields` must be a non-empty array", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Validate Zone existence
    const zoneDoc = await Zone.findById(zone).lean();
    if (!zoneDoc) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Check if subCategory is part of zone.subCategories
    const isSubCategoryInZone = Array.isArray(zoneDoc.subCategories) &&
      zoneDoc.subCategories.map((id: any) => String(id)).includes(String(subCategory));

    if (!isSubCategoryInZone) {
      sendResponse(
        res,
        null,
        "The provided subCategory does not belong to the selected zone.",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    // Validate SubCategory existence
    const subCategoryDoc = await SubCategory.findById(subCategory).lean();
    if (!subCategoryDoc) {
      sendResponse(res, null, "SubCategory not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Create the marketplace listing
    const newListing = new MarketplaceListing({
      user: req.user?.id,
      subCategory,
      zone,
      fields,
      ratings: {
        count: ratings?.count || 0,
        average: ratings?.average || 0,
      },
      description,
      currency,
      price,
      language,
      languages,
    });

    const saved = await newListing.save();

    sendResponse(res, saved, "Marketplace listing created successfully", STATUS_CODES.CREATED);
  } catch (err: any) {
    console.error("Error creating listing:", err);
    sendResponse(res, null, err.message || "Internal server error", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// READ ALL
export const getAllMarketplaceListings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const { page = 1, limit = 10 } = req.query;

    const baseQuery = MarketplaceListing.find()
      .populate("subCategory")
      .populate("zone")
      .populate("fields");

    const { data, total } = await paginateQuery(baseQuery, {
      page: +page,
      limit: +limit,
    });

    const final = data.map((doc: any) => {
      const obj = doc.toObject();

      // Translate listing content
      const listingLang = obj.languages?.find((l: any) => l.locale === locale);
      if (listingLang?.translations) {
        obj.description = listingLang.translations.description || obj.description;
      }
      delete obj.languages;

      // ADDED: Translate each field
      obj.fields = obj.fields.map((field: any) => {
        const match = field.languages?.find((l: any) => l.locale === locale);
        if (match?.translations) {
          field.name = match.translations.name || field.name;
          field.label = match.translations.label || field.label;
          field.placeholder = match.translations.placeholder || field.placeholder;
        }
        delete field.languages;
        return field;
      });

      // EXISTING: Translate subCategory
      const subCategoryObj = obj.subCategory as any;
      if (subCategoryObj && Array.isArray(subCategoryObj.languages)) {
        const match = subCategoryObj.languages.find((l: any) => l.locale === locale);
        if (match?.translations) {
          subCategoryObj.name = match.translations.name || subCategoryObj.name;
          subCategoryObj.description = match.translations.description || subCategoryObj.description;
        }
        delete subCategoryObj.languages;
      }

      return obj;
    });

    // Meta stats
    const uniqueUserIds = await MarketplaceListing.distinct("user");
    const totalUsersWithListings = uniqueUserIds.length;
    const totalMarketplaceListings = await MarketplaceListing.countDocuments();

    sendResponse(
      res,
      { listings: final, total, page: +page, limit: +limit, totalUsersWithListings, totalMarketplaceListings },
      `Fetched listings${locale !== "en" ? ` (locale: ${locale})` : ""}`,
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// READ ONE BY ID
export const getMarketplaceListingById = async (
  req: Request,
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
      .populate("fields") 
      .lean();

    if (!doc) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Translate listing content
    if (Array.isArray(doc.languages)) {
      const match = doc.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        doc.description = match.translations.description || doc.description;
      }
    }
    delete (doc as any).languages;

    //ADDED: Translate fields
    doc.fields = doc.fields.map((field: any) => {
      const match = field.languages?.find((l: any) => l.locale === locale);
      if (match?.translations) {
        field.name = match.translations.name || field.name;
        field.label = match.translations.label || field.label;
        field.placeholder = match.translations.placeholder || field.placeholder;
      }
      delete field.languages;
      return field;
    });

    //EXISTING: Translate subCategory
    const subCategoryObj = doc.subCategory as any;
    if (subCategoryObj && Array.isArray(subCategoryObj.languages)) {
      const match = subCategoryObj.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        subCategoryObj.name = match.translations.name || subCategoryObj.name;
        subCategoryObj.description = match.translations.description || subCategoryObj.description;
      }
      delete subCategoryObj.languages;
    }

    sendResponse(res, doc, "Listing fetched", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// UPDATE
export const updateMarketplaceListing = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const updated = await MarketplaceListing.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updated) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, updated, "Listing updated", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// DELETE
export const deleteMarketplaceListing = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const deleted = await MarketplaceListing.findByIdAndDelete(id);
    if (!deleted) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, deleted, "Listing deleted", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};
