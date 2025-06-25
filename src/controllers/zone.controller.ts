import { Request, Response, NextFunction } from "express";
import { Zone } from "../models/zone.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import mongoose from "mongoose";
import deleteFile from "../utils/deleteFile";
import path from "path";

// Get All Zones
export const getAllZones = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const zones = await Zone.aggregate([
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "zoneId",
          as: "categories",
        },
      },
    ]);
    sendResponse(res, zones, "All zones fetched successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

export const getZoneDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const zoneId = new mongoose.Types.ObjectId(req.params.id);

    const zone = await Zone.aggregate([
      {
        $match: { _id: zoneId },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "zoneId",
          as: "categories",
        },
      },
    ]);

    if (!zone || zone.length === 0) {
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      zone[0], // because aggregation returns an array
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
    } = req.body;

    // Convert radius to number if needed
    const radius =
      typeof radiusRaw === "string" ? Number(radiusRaw) : radiusRaw;

    // latLng should already be array, but if it's a string, parse it
    let latLng: number[] | undefined = undefined;
    if (latLngRaw) {
      if (typeof latLngRaw === "string") {
        latLng = JSON.parse(latLngRaw);
      } else {
        latLng = latLngRaw;
      }
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
      // Remove uploaded file if any because zone doesn't exist
      if (req.file) {
        deleteFile(req.file.path);
      }
      sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Parse and preprocess fields
    const { name, country, currency, timeZone, language, status, adminNotes } =
      req.body;

    const radius = req.body.radius
      ? Number(req.body.radius)
      : existingZone.radius;
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

    let thumbnail = existingZone.thumbnail;

    // If new thumbnail uploaded, delete old file and update
    if (req.file) {
      if (existingZone.thumbnail) {
        const oldFilePath = path.join(process.cwd(), existingZone.thumbnail);
        deleteFile(oldFilePath);
      }
      thumbnail = `/uploads/${req.file.filename}`;
    }

    // Update zone
    existingZone.name = name || existingZone.name;
    existingZone.currency = currency || existingZone.currency;
    existingZone.timeZone = timeZone || existingZone.timeZone;
    existingZone.language = language || existingZone.language;
    existingZone.radius = radius;
    existingZone.latLng = latLng;
    existingZone.adminNotes = adminNotes || existingZone.adminNotes;
    existingZone.thumbnail = thumbnail;

    await existingZone.save();

    sendResponse(
      res,
      existingZone,
      "Zone updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    // If error and new file was uploaded, delete it to prevent orphan files
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
