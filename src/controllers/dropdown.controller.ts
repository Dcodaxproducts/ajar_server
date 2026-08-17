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
      req.t("dropdown:allFetched"),
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
      sendResponse(res, null, req.t("dropdown:notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      dropdown,
      req.t("dropdown:fetched"),
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
      req.t("dropdown:created"),
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
      sendResponse(res, null, req.t("dropdown:notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    // Check if value already exists
    if (dropdown.values.find((v) => v.value === value)) {
      sendResponse(res, null, req.t("dropdown:valueExists"), STATUS_CODES.BAD_REQUEST);
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

    sendResponse(res, dropdown, req.t("dropdown:valueAdded"), STATUS_CODES.OK);
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
        req.t("dropdown:onlyDocumentSettings"),
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    if (!_id) {
      sendResponse(res, null, req.t("dropdown:idRequired"), STATUS_CODES.BAD_REQUEST);
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
        req.t("dropdown:settingsFieldRequired"),
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
      sendResponse(res, null, req.t("dropdown:valueNotFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      dropdown,
      req.t("dropdown:valueSettingsUpdated"),
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
      sendResponse(res, null, req.t("dropdown:notFound"), STATUS_CODES.NOT_FOUND);
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

    sendResponse(res, dropdown, req.t("dropdown:valueRemoved"), STATUS_CODES.OK);
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
      sendResponse(res, null, req.t("dropdown:notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    if (name === "userDocuments") {
      await Form.updateMany({}, { $set: { userDocuments: [] } });
    }
    if (name === "leaserDocuments") {
      await Form.updateMany({}, { $set: { leaserDocuments: [] } });
    }

    sendResponse(res, null, req.t("dropdown:deleted"), STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
