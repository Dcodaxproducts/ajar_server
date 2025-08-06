import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Field } from "../models/field.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { getLanguage } from "../utils/getLanguage";
import { paginateQuery } from "../utils/paginate";

// GET all fields
export const getAllFields = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    const baseQuery = Field.find();
    const { data, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    let filteredData = data;

    if (locale) {
      filteredData = data
        .filter((field: any) =>
          field.languages?.some((lang: any) => lang.locale === locale)
        )
        .map((field: any) => {
          const matchedLang = field.languages.find(
            (lang: any) => lang.locale === locale
          );

          const fieldObj = field.toObject();

          // Merge translation values to root level and remove original English
          if (matchedLang && matchedLang.translations) {
            fieldObj.name = matchedLang.translations.name || fieldObj.name;
            fieldObj.label = matchedLang.translations.label || fieldObj.label;
            fieldObj.placeholder =
              matchedLang.translations.placeholder || fieldObj.placeholder;
          }

          // Remove languages array to avoid duplication
          delete fieldObj.languages;

          return fieldObj;
        });
    }

    sendResponse(
      res,
      {
        fields: filteredData,
        total: filteredData.length,
        page: Number(page),
        limit: Number(limit),
      },
      `Fields fetched successfully${locale ? ` for locale: ${locale}` : ""}`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const getAllFieldsWithoutPagination = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    const fields = await Field.find();

    let filteredData = fields;

    if (locale) {
      filteredData = fields
        .filter((field: any) =>
          field.languages?.some((lang: any) => lang.locale === locale)
        )
        .map((field: any) => {
          const matchedLang = field.languages.find(
            (lang: any) => lang.locale === locale
          );

          const fieldObj = field.toObject();

          if (matchedLang?.translations) {
            fieldObj.name = matchedLang.translations.name || fieldObj.name;
            fieldObj.label = matchedLang.translations.label || fieldObj.label;
            fieldObj.placeholder =
              matchedLang.translations.placeholder || fieldObj.placeholder;
          }

          delete fieldObj.languages;

          return fieldObj;
        });
    }

    sendResponse(
      res,
      {
        fields: filteredData,
        // total: filteredData.length,
      },
      `Fields fetched successfully${locale ? ` for locale: ${locale}` : ""}`,
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
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Field ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const field = await Field.findById(id).lean();

    if (!field) {
      sendResponse(res, null, "Field not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (locale) {
      const matchedLang = field.languages?.find(
        (lang: any) => lang.locale === locale
      );

      if (matchedLang) {
        // Include translations directly in root and remove base values
        const { translations } = matchedLang;

        const translatedField = {
          ...field,
          ...translations,
        };

        delete translatedField.languages;

        sendResponse(
          res,
          translatedField,
          `Field details fetched successfully for locale: ${locale}`,
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

    // Ensure only defined fields are updated
    const sanitizedUpdates: any = {};
    for (const key in updates) {
      if (updates[key] !== undefined) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    // Step 1: Update the field
    await Field.findByIdAndUpdate(id, sanitizedUpdates, { new: true });

    // Step 2: Re-fetch updated field to include middleware changes
    const updatedField = await Field.findById(id).lean(false);

    if (!updatedField) {
      sendResponse(res, null, "Field not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      updatedField,
      "Field updated successfully",
      STATUS_CODES.OK
    );
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
