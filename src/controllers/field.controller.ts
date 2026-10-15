import { Request, Response, NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import { Field, IField } from "../models/field.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Form } from "../models/form.model";
import { paginateQuery } from "../utils/paginate";
import { removeEmptyConditional } from "../utils/fieldUtils";
import { HydratedDocument } from "mongoose";
import { localizeFieldForList } from "../utils/localizeFieldForList";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET all fields
export const getAllFields = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.min(50, Math.max(1, requestedLimit))
      : 10;
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;
    const search = typeof req.query.search === "string"
      ? req.query.search.trim().slice(0, 100)
      : "";
    const searchPattern = search ? new RegExp(escapeRegex(search), "i") : null;
    const filter = searchPattern
      ? {
          $or: [
            { name: searchPattern },
            { label: searchPattern },
            { "languages.translations.name": searchPattern },
            { "languages.translations.label": searchPattern },
          ],
        }
      : {};

    const baseQuery = Field.find(filter).sort({ createdAt: -1, _id: -1 });

    const { data, total } = await paginateQuery(baseQuery, {
      page,
      limit,
    });

    // A locale header selects translated presentation; it must never filter
    // persisted fields from the admin list when a translation is missing.
    const filteredData = data.map((field) =>
      localizeFieldForList(field, locale)
    );

    sendResponse(
      res,
      {
        fields: filteredData,
        total,
        page,
        limit,
      },
      `Fields fetched successfully${locale ? ` for locale: ${locale}` : ""}`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// GET bounded field selector page
export const getAllFieldsWithoutPagination = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;
    const isChoiceField = req.query.isChoiceField === "true";
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.min(200, Math.max(1, requestedLimit))
      : 100;

    const queryFilter: any = {};

    if (isChoiceField) {
      queryFilter.type = { $in: ["select", "radio"] };
    }

    // 1. Añadimos la población profunda (deep populate)
    const fieldsQuery = Field.find(queryFilter).sort({ createdAt: -1, _id: -1 }).populate({
      path: "conditional.dependsOn",
      populate: {
        path: "conditional.dependsOn",
        populate: {
          path: "conditional.dependsOn",
          populate: {
            path: "conditional.dependsOn",
            populate: {
              path: "conditional.dependsOn",
            },
          },
        },
      },
    });
    const { data: fields, total } = await paginateQuery(fieldsQuery, { page, limit });
    const filteredData = fields.map((field) => localizeFieldForList(field, locale));

    sendResponse(
      res,
      { fields: filteredData, total, page, limit },
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
      sendResponse(res, null, req.t("catalog:field.invalidId"), STATUS_CODES.BAD_REQUEST);
      return;
    }

    const field = await Field.findById(id).lean();

    if (!field) {
      sendResponse(res, null, req.t("catalog:field.notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      localizeFieldForList(field, locale),
      req.t("catalog:field.detailsFetched"),
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

    const existingField = await Field.findOne({ name: fieldData.name });
    if (existingField) {
      sendResponse(
        res,
        null,
        `A field with the name "${fieldData.name}" already exists`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    // ✅ Existing logic
    if (fieldData.type === "document" && !fieldData.documentConfig) {
      fieldData.documentConfig = [];
    }

    let parentField: HydratedDocument<IField> | null = null;

    // 🔐 CONDITIONAL VALIDATION
    if (fieldData.conditional && fieldData.conditional.dependsOn) {
      const { dependsOn, conditions } = fieldData.conditional;

      // 1️⃣ Conditional allowed only on select & radio
      if (!["select", "radio"].includes(fieldData.type)) {
        sendResponse(res, null, req.t("catalog:field.conditionalWrongType"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 2️⃣ dependsOn must be valid
      if (!mongoose.Types.ObjectId.isValid(dependsOn)) {
        sendResponse(res, null, req.t("catalog:field.conditionalMissingDependsOn"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 3️⃣ conditions array must exist and not be empty
      if (!Array.isArray(conditions) || conditions.length === 0) {
        sendResponse(res, null, "conditional.conditions must be a non-empty array", STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 4️⃣ Each condition must have a value
      const hasInvalidCondition = conditions.some(
        (c: { value: any; options?: string[] }) =>
          c.value === undefined || c.value === null
      );
      if (hasInvalidCondition) {
        sendResponse(res, null, req.t("catalog:field.conditionValueRequired"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 5️⃣ Parent field must exist
      parentField = await Field.findById(dependsOn);
      if (!parentField) {
        sendResponse(res, null, req.t("catalog:field.parentNotFound"), STATUS_CODES.NOT_FOUND);
        return;
      }

      // 6️⃣ Parent must be select or radio
      if (!["select", "radio"].includes(parentField.type || "")) {
        sendResponse(res, null, req.t("catalog:field.parentWrongType"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 7️⃣ Each condition value must match parent options
      if (parentField && parentField.options && parentField.options.length > 0) {
        const invalidValues = conditions
          .map((c: { value: any }) => c.value)
          .filter((v: any) => !parentField!.options!.includes(v));

        if (invalidValues.length > 0) {
          sendResponse(
            res,
            null,
            `Invalid condition values: ${invalidValues.join(", ")}. Must be one of: ${parentField.options.join(", ")}`,
            STATUS_CODES.BAD_REQUEST
          );
          return;
        }
      }
    }

    // ✅ Create field (unchanged)
    const newField = await Field.create(fieldData);

    sendResponse(
      res,
      newField,
      req.t("catalog:field.created"),
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
      sendResponse(res, null, req.t("catalog:field.invalidId"), STATUS_CODES.BAD_REQUEST);
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

    // ✅ CONDITIONAL VALIDATION
    if (updates.conditional && updates.conditional.dependsOn) {
      const { dependsOn, conditions } = updates.conditional;

      // 1️⃣ Conditional allowed only on select & radio
      if (!["select", "radio"].includes(updates.type)) {
        sendResponse(res, null, req.t("catalog:field.conditionalWrongType"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 2️⃣ dependsOn must be valid
      if (!mongoose.Types.ObjectId.isValid(dependsOn)) {
        sendResponse(res, null, req.t("catalog:field.conditionalMissingDependsOn"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 3️⃣ conditions array must exist and not be empty
      if (!Array.isArray(conditions) || conditions.length === 0) {
        sendResponse(res, null, "conditional.conditions must be a non-empty array", STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 4️⃣ Each condition must have a value
      const hasInvalidCondition = conditions.some(
        (c: { value: any; options?: string[] }) =>
          c.value === undefined || c.value === null
      );
      if (hasInvalidCondition) {
        sendResponse(res, null, req.t("catalog:field.conditionValueRequired"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 5️⃣ Parent field must exist
      const parentField = await Field.findById(dependsOn);
      if (!parentField) {
        sendResponse(res, null, req.t("catalog:field.parentNotFound"), STATUS_CODES.NOT_FOUND);
        return;
      }

      // 6️⃣ Parent must be select or radio
      if (!["select", "radio"].includes(parentField.type || "")) {
        sendResponse(res, null, req.t("catalog:field.parentWrongType"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      // 7️⃣ Each condition value must match parent options
      if (parentField && parentField.options && parentField.options.length > 0) {
        const invalidValues = conditions
          .map((c: { value: any }) => c.value)
          .filter((v: any) => !parentField!.options!.includes(v));

        if (invalidValues.length > 0) {
          sendResponse(
            res,
            null,
            `Invalid condition values: ${invalidValues.join(", ")}. Must be one of: ${parentField.options.join(", ")}`,
            STATUS_CODES.BAD_REQUEST
          );
          return;
        }
      }
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
      sendResponse(res, null, req.t("catalog:field.notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, updatedField, req.t("catalog:field.updated"), STATUS_CODES.OK);
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
      sendResponse(res, null, req.t("catalog:field.invalidId"), STATUS_CODES.BAD_REQUEST);
      return;
    }

    const field = await Field.findById(id);

    if (!field) {
      sendResponse(res, null, req.t("catalog:field.notFound"), STATUS_CODES.NOT_FOUND);
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

    sendResponse(res, deleted, req.t("catalog:field.deleted"), STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};