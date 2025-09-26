// src/controllers/form.controller.ts
import { Request, Response } from "express";
import { UserForm } from "../models/userForm.model";
import { Field } from "../models/field.model";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model"; //
import mongoose from "mongoose";

// Create new UserForm
export const createUserForm = async (req: Request, res: Response) => {
  try {
    const { zone, subCategory, fields, type } = req.body;

    if (!zone || !subCategory || !fields || !Array.isArray(fields)) {
      return sendResponse(
        res,
        null,
        "zone, subCategory and fields are required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // Check zone exists
    const zoneExists = await Zone.findById(zone);
    if (!zoneExists) {
      return sendResponse(res, null, "Invalid zone ID", STATUS_CODES.BAD_REQUEST);
    }

    // Check subCategory exists (must be type subCategory)
    const subCatExists = await Category.findOne({ _id: subCategory, type: "subCategory" });
    if (!subCatExists) {
      return sendResponse(res, null, "Invalid subCategory ID", STATUS_CODES.BAD_REQUEST);
    }

    // Check fields exist
    const existingFields = await Field.find({ _id: { $in: fields } });
    if (existingFields.length !== fields.length) {
      return sendResponse(res, null, "One or more fieldIds are invalid", STATUS_CODES.BAD_REQUEST);
    }

    const newUserForm = await UserForm.create({ zone, subCategory, fields, type });
    return sendResponse(res, newUserForm, "UserForm created successfully", STATUS_CODES.CREATED);
  } catch (error: any) {
    return sendResponse(res, null, error.message, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Get all UserForms
export const getUserForms = async (req: Request, res: Response) => {
  try {
    const { zone, subCategory, type } = req.query;
    const filter: any = {};

    if (zone && mongoose.Types.ObjectId.isValid(zone as string)) {
      filter.zone = new mongoose.Types.ObjectId(zone as string);
    }

    if (subCategory && mongoose.Types.ObjectId.isValid(subCategory as string)) {
      filter.subCategory = new mongoose.Types.ObjectId(subCategory as string);
    }

    if (type) filter.type = type;

    const userForms = await UserForm.find(filter)
      .populate("zone subCategory fields");

    return sendResponse(
      res,
      userForms,
      "UserForms fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error: any) {
    return sendResponse(res, null, error.message, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Get single UserForm
export const getUserFormById = async (req: Request, res: Response) => {
  try {
    const userForm = await UserForm.findById(req.params.id).populate("zone subCategory fields");
    if (!userForm) {
      return sendResponse(res, null, "UserForm not found", STATUS_CODES.NOT_FOUND);
    }
    return sendResponse(res, userForm, "UserForm fetched successfully", STATUS_CODES.OK);
  } catch (error: any) {
    return sendResponse(res, null, error.message, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Update UserForm
export const updateUserForm = async (req: Request, res: Response) => {
  try {
    const { zone, subCategory, fields, type } = req.body;

    if (fields) {
      const existingFields = await Field.find({ _id: { $in: fields } });
      if (existingFields.length !== fields.length) {
        return sendResponse(res, null, "One or more fieldIds are invalid", STATUS_CODES.BAD_REQUEST);
      }
    }

    const updatedUserForm = await UserForm.findByIdAndUpdate(
      req.params.id,
      { zone, subCategory, fields, type },
      { new: true }
    ).populate("zone subCategory fields");

    if (!updatedUserForm) {
      return sendResponse(res, null, "UserForm not found", STATUS_CODES.NOT_FOUND);
    }

    return sendResponse(res, updatedUserForm, "UserForm updated successfully", STATUS_CODES.OK);
  } catch (error: any) {
    return sendResponse(res, null, error.message, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Delete UserForm
export const deleteUserForm = async (req: Request, res: Response) => {
  try {
    const deletedUserForm = await UserForm.findByIdAndDelete(req.params.id);
    if (!deletedUserForm) {
      return sendResponse(res, null, "UserForm not found", STATUS_CODES.NOT_FOUND);
    }
    return sendResponse(res, deletedUserForm, "UserForm deleted successfully", STATUS_CODES.OK);
  } catch (error: any) {
    return sendResponse(res, null, error.message, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};
