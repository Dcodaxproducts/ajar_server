import { Request, Response, NextFunction } from "express";
import { Dropdown } from "../models/dropdown.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

// GET All Dropdowns
export const getAllDropdowns = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dropdowns = await Dropdown.find({}).lean();
    sendResponse(
      res,
      dropdowns,
      "All dropdowns fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// GET Dropdown by Name
export const getDropdownByName = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name } = req.params;
    const dropdown = await Dropdown.findOne({ name }).lean();

    if (!dropdown) {
      sendResponse(res, null, "Dropdown not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      dropdown,
      "Dropdown fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// CREATE Dropdown
export const createDropdown = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, values } = req.body;

    const uniqueValues = [
      ...new Map(values.map((v: any) => [v.value, v])).values(),
    ];
    const dropdown = await Dropdown.create({ name, values: uniqueValues });

    sendResponse(
      res,
      dropdown,
      "Dropdown created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

// ADD value to existing dropdown
export const addValueToDropdown = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name } = req.params;
    const { value, name: valueName, category } = req.body;

    const dropdown = await Dropdown.findOne({ name });

    if (!dropdown) {
      sendResponse(res, null, "Dropdown not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (dropdown.values.find((v) => v.value === value)) {
      sendResponse(res, null, "Value already exists", STATUS_CODES.BAD_REQUEST);
      return;
    }

    dropdown.values.push({ value, name: valueName });
    await dropdown.save();

    sendResponse(res, dropdown, "Value added successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// REMOVE value from dropdown
export const removeValueFromDropdown = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, value } = req.params;

    const dropdown = await Dropdown.findOne({ name });

    if (!dropdown) {
      sendResponse(res, null, "Dropdown not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    dropdown.values = dropdown.values.filter((v) => v.value !== value);
    await dropdown.save();

    sendResponse(res, dropdown, "Value removed successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// DELETE entire dropdown
export const deleteDropdown = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name } = req.params;

    const deleted = await Dropdown.findOneAndDelete({ name });

    if (!deleted) {
      sendResponse(res, null, "Dropdown not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, null, "Dropdown deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
