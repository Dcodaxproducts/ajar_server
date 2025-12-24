import { Request, Response, NextFunction } from "express";
import { IZone, Zone } from "../models/zone.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import mongoose, { Types } from "mongoose";
import deleteFile from "../utils/deleteFile";
import path from "path";
import { SubCategory } from "../models/category.model";
import { paginateQuery } from "../utils/paginate";
import { Form } from "../models/form.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { RefundManagement } from "../models/refundManagement.model";
import { RefundPolicy } from "../models/refundPolicy.model";

// helper for polygon check
const isPointInPolygon = (
  point: { lat: number; lng: number },
  polygon: { lat: number; lng: number }[]
): boolean => {
  let inside = false;
  const { lat, lng } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng,
      yi = polygon[i].lat;
    const xj = polygon[j].lng,
      yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const getAllZones = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10, lat, lng } = req.query;
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    // Apply sorting by latest first
    const baseQuery = Zone.find()
      .populate("subCategories")
      .sort({ createdAt: -1 });

    const { data, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    // Get the total count of all zones (unfiltered by pagination)
    const totalCount = await Zone.countDocuments();

    let filteredData = data;

    // Apply locale translations
    if (locale) {
      filteredData = filteredData
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

    // Apply lat/lng filter (supports bounding box OR polygon)
    if (lat && lng) {
      const point = { lat: Number(lat), lng: Number(lng) };

      filteredData = filteredData.filter((zone: any) =>
        zone.polygons?.some((polygon: any) => {
          if (!polygon || polygon.length < 1) return false;

          // If only 1 point → treat as marker (exact match)
          if (polygon.length === 1) {
            const p = polygon[0];
            return (
              Number(p.lat).toFixed(4) === Number(point.lat).toFixed(4) &&
              Number(p.lng).toFixed(4) === Number(point.lng).toFixed(4)
            );
          }

          // If 2 points → treat as bounding box
          if (polygon.length === 2) {
            const [sw, ne] = polygon;
            const minLat = Math.min(sw.lat, ne.lat);
            const maxLat = Math.max(sw.lat, ne.lat);
            const minLng = Math.min(sw.lng, ne.lng);
            const maxLng = Math.max(sw.lng, ne.lng);

            return (
              point.lat >= minLat &&
              point.lat <= maxLat &&
              point.lng >= minLng &&
              point.lng <= maxLng
            );
          }

          // If 3+ points → treat as polygon
          return isPointInPolygon(point, polygon);
        })
      );
    }

    sendResponse(
      res,
      {
        zones: filteredData,
        total: totalCount,
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

    console.log("Creating zone with data:", req.body);

    const existingZone = await Zone.findOne({
      name: { $regex: `^${name.trim()}$`, $options: "i" },
    });

    if (existingZone) {
      sendResponse(
        res,
        null,
        "Zone with this name already exists",
        STATUS_CODES.CONFLICT
      );
      return;
    }

    let polygons;
    if (rawPolygons) {
      polygons =
        typeof rawPolygons === "string" ? JSON.parse(rawPolygons) : rawPolygons;
      console.log("Parsed polygons:", polygons);
    }

    let subCategories: string[] = [];
    if (rawSubCategoryIds) {
      const parsedIds =
        typeof rawSubCategoryIds === "string"
          ? JSON.parse(rawSubCategoryIds)
          : rawSubCategoryIds;

      console.log("Parsed subCategory IDs:", parsedIds);

      if (!Array.isArray(parsedIds)) {
        console.warn("subCategories is not an array:", parsedIds);
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

      console.log("Valid subCategory IDs:", validIds);
      console.warn("Invalid subCategory IDs:", invalidIds);

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
    console.log("Zone created:", newZone);

    sendResponse(
      res,
      newZone,
      "Zone created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error creating zone:", error);
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

    //  Check if name is provided and not the same as existing name
    if (name && name !== existingZone.name) {
      const zoneWithSameName = await Zone.findOne({
        name: name.trim(),
        _id: { $ne: zoneId },
      });

      if (zoneWithSameName) {
        sendResponse(
          res,
          null,
          "Zone with this name already exists",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    //Handle polygons parsing
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

    //Handle subCategories properly as ObjectIds
    let subCategories = existingZone.subCategories;
    if (rawSubCategoryIds) {
      try {
        const parsedIds: string[] =
          typeof rawSubCategoryIds === "string"
            ? JSON.parse(rawSubCategoryIds)
            : rawSubCategoryIds;

        // Validate format
        const invalidObjectIds = parsedIds.filter(
          (id) => !mongoose.Types.ObjectId.isValid(id)
        );
        if (invalidObjectIds.length > 0) {
          sendResponse(
            res,
            null,
            `Invalid MongoDB ObjectId(s): ${invalidObjectIds.join(", ")}`,
            STATUS_CODES.BAD_REQUEST
          );
          return;
        }

        // Ensure they exist in SubCategory collection
        const validSubCategories = await SubCategory.find({
          _id: { $in: parsedIds },
          type: "subCategory",
        }).select("_id");

        const validIds = validSubCategories.map((cat) => cat._id.toString());
        const invalidIds = parsedIds.filter((id) => !validIds.includes(id));

        if (invalidIds.length > 0) {
          sendResponse(
            res,
            null,
            `Invalid subCategoriesId(s): ${invalidIds.join(", ")}`,
            STATUS_CODES.BAD_REQUEST
          );
          return;
        }

        //Assign ObjectIds, not strings
        subCategories = validIds.map((id) => new Types.ObjectId(id));
      } catch {
        subCategories = existingZone.subCategories;
      }
    }

    //Apply updates
    existingZone.name = name || existingZone.name;
    existingZone.currency = currency || existingZone.currency;
    existingZone.language = language || existingZone.language;
    existingZone.polygons = polygons;
    existingZone.languages = languages || existingZone.languages;
    existingZone.subCategories = subCategories;

    await existingZone.save();

    sendResponse(
      res,
      existingZone,
      "Zone updated successfully",
      STATUS_CODES.OK
    );
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
    const zone = await Zone.findById(zoneId);
    if (!zone) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Delete all records referencing this Zone
    await Promise.all([
      Form.deleteMany({ zone: zoneId }),
      MarketplaceListing.deleteMany({ zone: zoneId }),
      RefundManagement.deleteMany({ zone: zoneId }),
      RefundPolicy.deleteMany({ zone: zoneId }),
    ]);

    // Now delete the Zone itself
    await zone.deleteOne();

    sendResponse(
      res,
      null,
      "Zone and related records deleted successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const addSubCategoriesToZone = async (
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
    const zone = await Zone.findById(zoneId);
    if (!zone) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const { subCategories: rawSubCategoryIds } = req.body;

    if (!rawSubCategoryIds) {
      sendResponse(
        res,
        null,
        "subCategories is required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const parsedIds: string[] =
      typeof rawSubCategoryIds === "string"
        ? JSON.parse(rawSubCategoryIds)
        : rawSubCategoryIds;

    // Validate ObjectIds
    const invalidObjectIds = parsedIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id)
    );
    if (invalidObjectIds.length > 0) {
      sendResponse(
        res,
        null,
        `Invalid MongoDB ObjectId(s): ${invalidObjectIds.join(", ")}`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    // Check DB for valid SubCategories
    const existingSubCategories = await SubCategory.find({
      _id: { $in: parsedIds },
      type: "subCategory",
    }).select("_id");

    const existingIds = existingSubCategories.map((cat) => cat._id.toString());
    const nonExistentIds = parsedIds.filter((id) => !existingIds.includes(id));

    if (nonExistentIds.length > 0) {
      sendResponse(
        res,
        null,
        `SubCategory ID(s) not found in DB: ${nonExistentIds.join(", ")}`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    // Save ObjectIds
    zone.subCategories = existingIds.map((id) => new Types.ObjectId(id));
    await zone.save();

    sendResponse(
      res,
      zone,
      "Subcategories updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
