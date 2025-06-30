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
    const baseQuery = Zone.find().populate("subCategoriesId");
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
    const zone = await Zone.findById(id).populate("subCategoriesId").lean();

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

export const createZone = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      name,
      country,
      currency,
      timeZone,
      language,
      radius: radiusRaw,
      latLng: latLngRaw,
      adminNotes,
      status,
      subCategoriesId: rawSubCategoryIds,
    } = req.body;

    const radius =
      typeof radiusRaw === "string" ? Number(radiusRaw) : radiusRaw;

    let latLng;
    if (latLngRaw) {
      latLng =
        typeof latLngRaw === "string" ? JSON.parse(latLngRaw) : latLngRaw;
    }

    // Parse and validate subCategoriesId
    let subCategoriesId: string[] = [];
    if (rawSubCategoryIds) {
      const parsedIds =
        typeof rawSubCategoryIds === "string"
          ? JSON.parse(rawSubCategoryIds)
          : rawSubCategoryIds;

      if (!Array.isArray(parsedIds)) {
        // return sendResponse(res, null, "subCategoriesId must be an array", STATUS_CODES.BAD_REQUEST);
        sendResponse(
          res,
          null,
          "subCategoriesId must be an array",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // Check if all IDs exist and are subCategories
      const validSubCategories = await SubCategory.find({
        _id: { $in: parsedIds },
        categoryType: "subCategory",
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
        // return sendResponse(
        //   res,
        //   null,
        //   `Invalid subCategoriesId(s): ${invalidIds.join(", ")}`,
        //   STATUS_CODES.BAD_REQUEST
        // );
      }

      subCategoriesId = validIds;
    }

    const thumbnail = req.file ? `/uploads/${req.file.filename}` : undefined;

    const newZone = new Zone({
      name,
      country,
      currency,
      timeZone,
      language,
      radius,
      latLng,
      thumbnail,
      adminNotes,
      status,
      subCategoriesId,
    });

    await newZone.save();

    sendResponse(
      res,
      newZone,
      "Zone created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

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
      if (req.file) {
        deleteFile(req.file.path);
      }
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Destructure fields from request body
    const { name, country, currency, timeZone, language, status, adminNotes } =
      req.body;

    // Handle radius
    const radius = req.body.radius
      ? Number(req.body.radius)
      : existingZone.radius;

    // Handle latLng
    let latLng;
    if (req.body.latLng) {
      try {
        latLng = JSON.parse(req.body.latLng);
      } catch {
        latLng = existingZone.latLng;
      }
    } else {
      latLng = existingZone.latLng;
    }

    // Handle subCategoriesId (parse if stringified)
    let subCategoriesId = req.body.subCategoriesId;
    if (typeof subCategoriesId === "string") {
      try {
        subCategoriesId = JSON.parse(subCategoriesId);
      } catch {
        subCategoriesId = existingZone.subCategoriesId;
      }
    }

    // Handle thumbnail
    let thumbnail = existingZone.thumbnail;
    if (req.file) {
      if (existingZone.thumbnail) {
        const oldFilePath = path.join(process.cwd(), existingZone.thumbnail);
        deleteFile(oldFilePath);
      }
      thumbnail = `/uploads/${req.file.filename}`;
    }

    // Update fields
    existingZone.name = name || existingZone.name;
    existingZone.country = country || existingZone.country;
    existingZone.currency = currency || existingZone.currency;
    existingZone.timeZone = timeZone || existingZone.timeZone;
    existingZone.language = language || existingZone.language;
    existingZone.radius = radius;
    existingZone.latLng = latLng;
    existingZone.adminNotes = adminNotes || existingZone.adminNotes;
    existingZone.thumbnail = thumbnail;
    existingZone.subCategoriesId =
      subCategoriesId || existingZone.subCategoriesId;

    await existingZone.save();

    sendResponse(
      res,
      existingZone,
      "Zone updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    if (req.file) {
      deleteFile(req.file.path);
    }
    next(error);
  }
};

export const updateZoneThumbnail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const zoneId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(zoneId)) {
    if (req.file) deleteFile(req.file.path);
    sendResponse(res, null, "Invalid Zone ID", STATUS_CODES.BAD_REQUEST);
    return;
  }

  try {
    const zone = await Zone.findById(zoneId);
    if (!zone) {
      if (req.file) deleteFile(req.file.path);
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (!req.file) {
      sendResponse(res, null, "No file uploaded", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Delete old thumbnail file if exists
    if (zone.thumbnail) {
      const oldFilePath = path.join(process.cwd(), zone.thumbnail);
      deleteFile(oldFilePath);
    }

    zone.thumbnail = `/uploads/${req.file.filename}`;

    await zone.save();

    sendResponse(res, zone, "Thumbnail updated successfully", STATUS_CODES.OK);
  } catch (error) {
    if (req.file) deleteFile(req.file.path);
    next(error);
  }
};

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

    // Delete thumbnail file if exists
    if (zone.thumbnail) {
      const oldFilePath = path.join(process.cwd(), zone.thumbnail);
      deleteFile(oldFilePath);
    }

    sendResponse(res, zone, "Zone deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
