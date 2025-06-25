import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Field } from "../models/field.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { getLanguage } from "../utils/getLanguage";

// GET all fields
export const getAllFields = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const query: any = {};
    const languageHeader = req.headers["language"];

    // Only filter by language if it’s provided in the header
    if (languageHeader) {
      query.language = languageHeader.toString();
    }

    const { zoneId } = req.query;
    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId as string)) {
      query.zoneId = zoneId;
    }

    const fields = await Field.find(query).lean();

    sendResponse(
      res,
      fields,
      "All fields fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};


// GET field by ID
export const getFieldDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Field ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const field = await Field.findById(id).lean();

    if (!field) {
      sendResponse(res, null, "Field not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      field,
      "Field details fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// CREATE new field
export const createNewField = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const fieldData = req.body;
     
    const newField = new Field(fieldData);
    await newField.save();

    sendResponse(
      res,
      newField,
      "Field created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

// UPDATE field
export const updateField = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Field ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    //Ensure only defined fields are updated (ignore undefined values)
    const sanitizedUpdates: any = {};
    for (const key in updates) {
      if (updates[key] !== undefined) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    const updatedField = await Field.findByIdAndUpdate(id, sanitizedUpdates, {
      new: true,
    });

    if (!updatedField) {
      sendResponse(res, null, "Field not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, updatedField, "Field updated successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};


// DELETE field
export const deleteField = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Field ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const deleted = await Field.findByIdAndDelete(id);

    if (!deleted) {
      sendResponse(res, null, "Field not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, deleted, "Field deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
