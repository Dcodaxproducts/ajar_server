import { Request, Response, NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import { Field } from "../models/field.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Form } from "../models/form.model";
import { paginateQuery } from "../utils/paginate";
import { removeEmptyConditional } from "../utils/fieldUtils";

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

    const baseQuery = Field.find().sort({ createdAt: -1 });

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

          if (matchedLang && matchedLang.translations) {
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
        total,
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

// GET all fields without pagination
export const getAllFieldsWithoutPagination = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;
    const isChoiceField = req.query.isChoiceField;

    const queryFilter: any = {};

    if (isChoiceField) {
      queryFilter.type = { $in: ["select", "radio"] };
    }

    const fields = await Field.find(queryFilter);

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
      { fields: filteredData },
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
        const { translations } = matchedLang;
        const translatedField = { ...field, ...translations };
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

// CREATE new Feild
export const createNewField = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const fieldData = req.body;

    removeEmptyConditional(fieldData);

    // ✅ Existing logic
    if (fieldData.type === "document" && !fieldData.documentConfig) {
      fieldData.documentConfig = [];
    }

    let parentField = null;

    // 🔐 CONDITIONAL VALIDATION
    if (
      fieldData.conditional &&
      fieldData.conditional.dependsOn &&
      fieldData.conditional.value !== null &&
      fieldData.conditional.value !== undefined
    ) {
      const { dependsOn, value } = fieldData.conditional;

      // 1️⃣ Conditional allowed only on select & radio
      if (!["select", "radio"].includes(fieldData.type)) {
        sendResponse(
          res,
          null,
          "Conditional logic is only allowed on select or radio fields",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      // 2️⃣ dependsOn must exist
      if (!dependsOn || !mongoose.Types.ObjectId.isValid(dependsOn)) {
        sendResponse(
          res,
          null,
          "Invalid or missing conditional.dependsOn",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      // 3️⃣ value must exist
      if (value === undefined || value === null) {
        sendResponse(
          res,
          null,
          "conditional.value is required when conditional is provided",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      // 4️⃣ Parent field must exist
      parentField = await Field.findById(dependsOn);

      if (!parentField) {
        sendResponse(
          res,
          null,
          "Parent field not found",
          STATUS_CODES.NOT_FOUND
        );
        return;
      }

      // 5️⃣ Parent field must be select or radio
      if (!["select", "radio"].includes(parentField.type || "")) {
        sendResponse(
          res,
          null,
          "Parent field must be of type select or radio",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      // 6️⃣ conditional.value must match parent options
      if (
        parentField.options &&
        !parentField.options.includes(value)
      ) {
        sendResponse(
          res,
          null,
          `Value must be one of: ${parentField.options.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    // ✅ Create field (unchanged)
    const newField = await Field.create(fieldData);

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


// export const createNewField = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const fieldData = req.body;

//     // If type is "document" but no config is provided, set a default empty array
//     if (fieldData.type === "document" && !fieldData.documentConfig) {
//       fieldData.documentConfig = [];
//     }

//     const newField = new Field(fieldData);
//     await newField.save();

//     sendResponse(
//       res,
//       newField,
//       "Field created successfully",
//       STATUS_CODES.CREATED
//     );
//   } catch (error) {
//     next(error);
//   }
// };



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

    if (updates.type === "document" && !updates.documentConfig) {
      sendResponse(
        res,
        null,
        "documentConfig is required for document fields",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const sanitizedUpdates: any = {};
    for (const key in updates) {
      if (updates[key] !== undefined) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    await Field.findByIdAndUpdate(id, sanitizedUpdates, { new: true });

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

    const field = await Field.findById(id);

    if (!field) {
      sendResponse(res, null, "Field not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Restricted field names
    const restrictedNames = [
      "name",
      "subTitle",
      "description",
      "price",
      "rentalImages",
    ];

    // Check if the field name is restricted
    if (restrictedNames.includes(field.name)) {
      sendResponse(
        res,
        null,
        `You cannot delete the '${field.name}' field.`,
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    // Proceed to delete
    const deleted = await Field.findByIdAndDelete(id);

    await Form.updateMany({ fields: id }, { $pull: { fields: id } });

    sendResponse(res, deleted, "Field deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
