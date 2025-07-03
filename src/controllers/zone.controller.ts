import { Request, Response, NextFunction } from "express";
import { IZone, Zone } from "../models/zone.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import mongoose from "mongoose";
import deleteFile from "../utils/deleteFile";
import path from "path";
import { SubCategory } from "../models/category.model";
import { paginateQuery } from "../utils/paginate";

// Get All Zones
export const getAllZones = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    // const baseQuery = Zone.find();
    const baseQuery = Zone.find().populate("subCategories");
    const { data, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    let filteredData = data;

    if (locale) {
      filteredData = data
        .filter((zone: any) =>
          zone.languages?.some((lang: any) => lang.locale === locale)
        )
        .map((zone: any) => {
          const matchedLang = zone.languages.find(
            (lang: any) => lang.locale === locale
          );

          const zoneObj = zone.toObject();

          if (matchedLang && matchedLang.translations) {
            zoneObj.name = matchedLang.translations.name || zoneObj.name;
            zoneObj.adminNotes =
              matchedLang.translations.adminNotes || zoneObj.adminNotes;
          }

          delete zoneObj.languages;

          return zoneObj;
        });
    }

    sendResponse(
      res,
      {
        zones: filteredData,
        total: filteredData.length,
        page: Number(page),
        limit: Number(limit),
      },
      `Zones fetched successfully${locale ? ` for locale: ${locale}` : ""}`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// GET Zone by ID with Locale-based Translations
export const getZoneDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Zone ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // const zone = await Zone.findById(id).lean();
    const zone = await Zone.findById(id).populate("subCategories").lean();

    if (!zone) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (locale) {
      const matchedLang = zone.languages?.find(
        (lang: any) => lang.locale === locale
      );

      if (matchedLang) {
        const translatedZone = {
          ...zone,
          ...matchedLang.translations,
        };

        delete translatedZone.languages;

        sendResponse(
          res,
          translatedZone,
          `Zone details fetched successfully for locale: ${locale}`,
          STATUS_CODES.OK
        );
        return;
      } else {
        sendResponse(
          res,
          null,
          `No translations found for locale: ${locale}`,
          STATUS_CODES.NOT_FOUND
        );
        return;
      }
    }

    sendResponse(
      res,
      zone,
      "Zone details fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

//create zone
export const createZone = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      name,
      currency,
      timeZone,
      language,
      polygons: rawPolygons,
      languages,
      subCategories: rawSubCategoryIds,
    } = req.body;

    let polygons;
    if (rawPolygons) {
      polygons =
        typeof rawPolygons === "string" ? JSON.parse(rawPolygons) : rawPolygons;
    }

    let subCategories: string[] = [];
    if (rawSubCategoryIds) {
      const parsedIds =
        typeof rawSubCategoryIds === "string"
          ? JSON.parse(rawSubCategoryIds)
          : rawSubCategoryIds;

      if (!Array.isArray(parsedIds)) {
        sendResponse(
          res,
          null,
          "subCategories must be an array",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      const validSubCategories = await SubCategory.find({
        _id: { $in: parsedIds },
        type: "subCategory",
      }).select("_id");

      const validIds = validSubCategories.map((cat) => cat._id.toString());
      const invalidIds = parsedIds.filter(
        (id: string) => !validIds.includes(id)
      );

      if (invalidIds.length > 0) {
        sendResponse(
          res,
          null,
          `Invalid subCategories: ${invalidIds.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      subCategories = validIds;
    }

    const newZone = new Zone({
      name,
      currency,
      timeZone,
      language,
      polygons,
      languages,
      subCategories,
    });

    await newZone.save();

    sendResponse(res, newZone, "Zone created successfully", STATUS_CODES.CREATED);
  } catch (error) {
    next(error);
  }
};

//update zone
export const updateZone = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const zoneId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(zoneId)) {
    sendResponse(res, null, "Invalid Zone ID", STATUS_CODES.BAD_REQUEST);
    return;
  }

  try {
    const existingZone = await Zone.findById(zoneId);
    if (!existingZone) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const {
      name,
      currency,
      language,
      polygons: rawPolygons,
      languages,
      subCategories: rawSubCategoryIds,
    } = req.body;

    let polygons = existingZone.polygons;
    if (rawPolygons) {
      try {
        polygons =
          typeof rawPolygons === "string"
            ? JSON.parse(rawPolygons)
            : rawPolygons;
      } catch {
        polygons = existingZone.polygons;
      }
    }

    let subCategories = existingZone.subCategories.map((id) => id.toString());
    if (rawSubCategoryIds) {
      try {
        const parsedIds =
          typeof rawSubCategoryIds === "string"
            ? JSON.parse(rawSubCategoryIds)
            : rawSubCategoryIds;

        const validSubCategories = await SubCategory.find({
          _id: { $in: parsedIds },
          type: "subCategory",
        }).select("_id");

        const validIds = validSubCategories.map((cat) => cat._id.toString());
        const invalidIds = parsedIds.filter(
          (id: string) => !validIds.includes(id)
        );

        if (invalidIds.length > 0) {
          sendResponse(
            res,
            null,
            `Invalid subCategoriesId(s): ${invalidIds.join(", ")}`,
            STATUS_CODES.BAD_REQUEST
          );
          return;
        }

        subCategories = validIds;
      } catch {
        // subCategories = existingZone.subCategories;
        subCategories = existingZone.subCategories.map((id) => id.toString());
      }
    }

    existingZone.name = name || existingZone.name;
    existingZone.currency = currency || existingZone.currency;
    existingZone.language = language || existingZone.language;
    existingZone.polygons = polygons;
    existingZone.languages = languages || existingZone.languages;
    existingZone.subCategories = subCategories;

    await existingZone.save();

    sendResponse(res, existingZone, "Zone updated successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

//delete zone
export const deleteZone = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const zoneId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(zoneId)) {
    sendResponse(res, null, "Invalid Zone ID", STATUS_CODES.BAD_REQUEST);
    return;
  }

  try {
    const zone = await Zone.findByIdAndDelete(zoneId);
    if (!zone) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, zone, "Zone deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
