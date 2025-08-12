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
    const { subCategory, zone } = req.body;

    // Validate required fields
    if (!subCategory || !zone) {
      sendResponse(
        res,
        null,
        "`subCategory` and `zone` are required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    // Validate Zone existence
    const zoneDoc = await Zone.findById(zone).lean();
    if (!zoneDoc) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Check if subCategory is part of zone.subCategories
    const isSubCategoryInZone =
      Array.isArray(zoneDoc.subCategories) &&
      zoneDoc.subCategories
        .map((id: any) => String(id))
        .includes(String(subCategory));

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

    //Handle uploaded image(s)
    const images: string[] = [];
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (files?.images) {
      for (const file of files.images) {
        images.push(`/uploads/${file.filename}`);
      }
    }

    // Save everything from req.body + user
    const newListing = new MarketplaceListing({
      ...req.body,
      leaser: req.user?.id,
      images,
    });

    const saved = await newListing.save();

    sendResponse(
      res,
      saved,
      "Marketplace listing created successfully",
      STATUS_CODES.CREATED
    );
  } catch (err: any) {
    console.error("Error creating listing:", err);
    sendResponse(
      res,
      null,
      err.message || "Internal server error",
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
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
    const { page = 1, limit = 10, zone, subCategory } = req.query;

    const filter: any = {};

    //Apply role-based access
    if (req.user?.role !== "admin") {
      if (!zone) {
        sendResponse(
          res,
          null,
          "`zone` is required for users",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      if (mongoose.Types.ObjectId.isValid(String(zone))) {
        filter.zone = zone;
      }
    } else {
      if (zone && mongoose.Types.ObjectId.isValid(String(zone))) {
        filter.zone = zone;
      }
    }

    if (subCategory && mongoose.Types.ObjectId.isValid(String(subCategory))) {
      filter.subCategory = subCategory;
    }

    //Adjusted population (removed full zone, limited fields from user & subCategory)
    const baseQuery = MarketplaceListing.find(filter)
      .populate("leaser", "_id name profilePicture phone createdAt updatedAt")
      .populate("subCategory", "_id name thumbnail createdAt updatedAt");

    const { data, total } = await paginateQuery(baseQuery, {
      page: +page,
      limit: +limit,
    });

    const final = data.map((doc: any) => {
      const obj = doc.toObject();

      //Translate description by language
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

    //EXISTING: Translate subCategory
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

// UPDATE
export const updateMarketplaceListing = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    //Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    //Find existing listing
    const existingListing = await MarketplaceListing.findById(id);
    if (!existingListing) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    //Authorization: only leaser can update
    if (String(existingListing.leaser) !== String(req.user?.id)) {
      sendResponse(
        res,
        null,
        "Forbidden: You are not the owner of this listing",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    //Handle uploaded image files
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    let newImages: string[] = [];

    if (files?.image && Array.isArray(files.image)) {
      newImages = files.image.map((file) => `/uploads/${file.filename}`);
    }

    //Merge or replace images
    const updatedFields = {
      ...req.body,
      images: newImages.length > 0 ? newImages : existingListing.images,
    };

    //Update document
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
