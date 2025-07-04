import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { paginateQuery } from "../utils/paginate";
import { MarketplaceListing } from "../models/marketplaceListings.Model";

// CREATE
export const createMarketplaceListing = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      form,
      fields,
      ratings,
      description,
      currency,
      price,
      language = "en",
      languages,
     
    } = req.body;

    // Don't parse fields, it's already an object
    if (!Array.isArray(fields)) {
      sendResponse(res, null, "`fields` must be an array", 400);
      return;
    }

    // if (!Array.isArray(requiredDocuments)) {
    //   sendResponse(res, null, "`requiredDocuments` must be an array", 400);
    //   return;
    // }

    const newListing = new MarketplaceListing({
      form,
      fields,
      ratings,
      description,
      currency,
      price,
      language,
      languages,
      // requiredDocuments
    });

    const saved = await newListing.save();

    sendResponse(res, saved, "Marketplace listing created successfully", 201);
  } catch (err: any) {
    console.error("Error creating listing:", err);
    sendResponse(res, null, err.message || "Internal server error", 500);
  }
};



// READ LIST
export const getAllMarketplaceListings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const { page = 1, limit = 10 } = req.query;

    const baseQuery = MarketplaceListing.find();
    const { data, total } = await paginateQuery(baseQuery, {
      page: +page,
      limit: +limit,
    });

    const final = data.map((doc: any) => {
      const obj = doc.toObject();
      const match = obj.languages?.find((l: any) => l.locale === locale);
      if (match?.translations) {
        obj.description = match.translations.description || obj.description;
        obj.fields = obj.fields.map((f: any) => ({
          ...f,
          name: match.translations.name || f.name,
        }));
      }
      delete obj.languages;
      return obj;
    });

    sendResponse(
      res,
      { listings: final, total, page: +page, limit: +limit },
      `Fetched listings${locale !== "en" ? ` (locale: ${locale})` : ""}`,
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// READ ONE
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

    const doc = await MarketplaceListing.findById(id).lean();
    if (!doc) {
      sendResponse(res, null, "Listing not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (Array.isArray(doc.languages)) {
      const match = doc.languages.find((l: any) => l.locale === locale);
      if (match?.translations) {
        doc.description = match.translations.description || doc.description;
        doc.fields = doc.fields.map((f: any) => ({
          ...f,
          name: match.translations.name || f.name,
        }));
      }
    }

    delete (doc as any).languages;
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
