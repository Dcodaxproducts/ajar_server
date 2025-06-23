import { Request, Response, NextFunction } from "express";
import { Form } from "../models/form.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Field } from "../models/field.model";
import mongoose from "mongoose";

export const createNewForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { title, for: forEntity, reference, fields } = req.body;

    console.log({ first: req.body });

    const modelName = forEntity; // Assuming 'forEntity' is the intended model name
    if (!mongoose.models[capitalize(modelName)]) {
      sendResponse(
        res,
        null,
        "Invalid model reference",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const Model = mongoose.model(capitalize(modelName));
    const exists = await Model.exists({ _id: reference });

    if (!exists) {
      sendResponse(res, null, `${modelName} not found`, STATUS_CODES.NOT_FOUND);
      return;
    }

    const refDetails = await Model.findById(reference);

    if (!refDetails) {
      sendResponse(res, null, `${modelName} not found`, STATUS_CODES.NOT_FOUND);
      return;
    }

    // insert multiple fields into database and get their ids
    const insertedFields = await Field.insertMany(fields);
    const fieldIds = insertedFields.map((field) => field._id);

    const form = new Form({
      title,
      for: modelName,
      reference,
      fields: fieldIds,
    });

    refDetails.form = form._id;
    await refDetails.save();

    await form.save();
    sendResponse(res, form, "Form created successfully", STATUS_CODES.CREATED);
  } catch (error) {
    next(error);
  }
};

export const getAllForms = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const forms = await Form.find().lean();
    sendResponse(res, forms, "All forms fetched successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

export const getFormDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const form = await Form.findById(req.params.id).lean();
    if (!form) {
      sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
      return;
    }
    sendResponse(
      res,
      form,
      "Form details fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const deleteForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const deleted = await Form.findByIdAndDelete(req.params.id);
    if (!deleted) {
      sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
      return;
    }
    sendResponse(res, null, "Form deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

function capitalize(modelName: string): string {
  if (!modelName || typeof modelName !== "string") {
    throw new Error("Invalid model name");
  }
  return modelName.charAt(0).toUpperCase() + modelName.slice(1);
}
