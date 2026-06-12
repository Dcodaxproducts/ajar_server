import { Request, Response, NextFunction } from "express";
import { Dropdown } from "../models/dropdown.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Form } from "../models/form.model";

const allowedDocumentTypes = ["leaserDocuments", "renterDocuments", "userDocuments"];

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
    const { value, name: valueName, hasExpiry, autoApproval } = req.body;

    const dropdown = await Dropdown.findOne({ name });

    if (!dropdown) {
      sendResponse(res, null, "Dropdown not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Check if value already exists
    if (dropdown.values.find((v) => v.value === value)) {
      sendResponse(res, null, "Value already exists", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Define the allowed dropdown names for these extra features
    const isDocumentType = allowedDocumentTypes.includes(name);

    // Prepare the new value object
    const newValue: any = { 
      value, 
      name: valueName 
    };

    // Only add toggles if it's one of the document-related dropdowns
    if (isDocumentType) {
      newValue.hasExpiry = hasExpiry ?? false;
      newValue.autoApproval = autoApproval ?? false;
    }

    dropdown.values.push(newValue);
    await dropdown.save();

    sendResponse(res, dropdown, "Value added successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// UPDATE document dropdown value settings
export const updateDropdownValueSettings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name } = req.params;
    const { _id, hasExpiry, autoApproval } = req.body;

    if (!allowedDocumentTypes.includes(name)) {
      sendResponse(
        res,
        null,
        "Only document dropdown settings can be updated",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    if (!_id) {
      sendResponse(res, null, "_id is required", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const updateFields: Record<string, boolean> = {};

    if (typeof hasExpiry === "boolean") {
      updateFields["values.$.hasExpiry"] = hasExpiry;
    }

    if (typeof autoApproval === "boolean") {
      updateFields["values.$.autoApproval"] = autoApproval;
    }

    if (!Object.keys(updateFields).length) {
      sendResponse(
        res,
        null,
        "hasExpiry or autoApproval is required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const dropdown = await Dropdown.findOneAndUpdate(
      { name, "values._id": _id },
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!dropdown) {
      sendResponse(res, null, "Dropdown value not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      dropdown,
      "Dropdown value settings updated successfully",
      STATUS_CODES.OK
    );
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

    if (name === "userDocuments") {
      await Form.updateMany(
        { userDocuments: value },
        { $pull: { userDocuments: value } }
      );
    }
    if (name === "leaserDocuments") {
      await Form.updateMany(
        { leaserDocuments: value },
        { $pull: { leaserDocuments: value } }
      );
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

    if (name === "userDocuments") {
      await Form.updateMany({}, { $set: { userDocuments: [] } });
    }
    if (name === "leaserDocuments") {
      await Form.updateMany({}, { $set: { leaserDocuments: [] } });
    }

    sendResponse(res, null, "Dropdown deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
