import { Request, Response, NextFunction } from "express";
import { Form } from "../models/form.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Field } from "../models/field.model";
import mongoose from "mongoose";
import { paginateQuery } from "../utils/paginate";

// CREATE NEW FORM
export const createNewForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      name,
      description,
      subCategory,
      zone,
      fields = [],
      language,
      setting,
      userDocuments,
      leaserDocuments,
    } = req.body;

    if (!name || !description) {
      sendResponse(res, null, "Form name and description are required", STATUS_CODES.BAD_REQUEST);
      return
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(subCategory) || !mongoose.Types.ObjectId.isValid(zone)) {
      sendResponse(res, null, "Invalid subCategoryId or zoneId", STATUS_CODES.BAD_REQUEST);
      return
    }

    // 1. Check Uniqueness
    const formAlreadyExists = await Form.findOne({ subCategory, zone });
    if (formAlreadyExists) {
      sendResponse(res, null, "Form already exists for this zone and sub-category", STATUS_CODES.CONFLICT);
      return
    }

    // 2. Validate User Selected Fields & Maintain Order
    const validUserFieldsRaw = await Field.find({ _id: { $in: fields } });
    if (validUserFieldsRaw.length !== fields.length) {
      sendResponse(res, null, "Some selected fields are invalid", STATUS_CODES.BAD_REQUEST);
      return
    }

    // Map IDs to maintain the exact order sent by frontend
    const userFieldIds = fields.map((id: string) => new mongoose.Types.ObjectId(id));

    // 3. Required system fields
    const requiredFieldNames = ["name", "subTitle", "description", "price", "priceUnit", "rentalImages"];
    const requiredFields = await Field.find({ name: { $in: requiredFieldNames } });

    if (requiredFields.length !== requiredFieldNames.length) {
      sendResponse(res, null, "Required system fields missing in database", STATUS_CODES.BAD_REQUEST);
      return
    }

    // 4. Fixed fields
    const fixedFields = await Field.find({ isFixed: true });

    const allFieldIds: mongoose.Types.ObjectId[] = [
      ...requiredFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...fixedFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...userFieldIds,
    ];

    // Deduplicate just in case
    const uniqueFieldIds = Array.from(
      new Map(allFieldIds.map((id) => [id.toString(), id])).values()
    );

    const form = new Form({
      name,
      description,
      subCategory,
      zone,
      fields: uniqueFieldIds,
      language,
      setting,
      userDocuments,
      leaserDocuments,
    });

    await form.save();

    // 5. Return populated response (5 levels deep)
    const populatedForm = await Form.findById(form._id)
      .populate("zone")
      .populate("subCategory")
      .populate({
        path: "fields",
        populate: {
          path: "conditional.dependsOn",
          populate: {
            path: "conditional.dependsOn",
            populate: {
              path: "conditional.dependsOn",
              populate: {
                path: "conditional.dependsOn",
                populate: { path: "conditional.dependsOn" } // 5 Levels
              }
            }
          }
        },
      });

    sendResponse(res, populatedForm, "Form created successfully", STATUS_CODES.CREATED);
  } catch (error) {
    next(error);
  }
};

// export const createNewForm = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const {
//       name,
//       description,
//       subCategory,
//       zone,
//       fields = [],
//       language,
//       setting,
//       userDocuments,
//       leaserDocuments,
//     } = req.body;

//     if (!name || !description) {
//       sendResponse(
//         res,
//         null,
//         "Form name and description are required",
//         STATUS_CODES.BAD_REQUEST
//       );
//       return;
//     }

//     if (
//       !mongoose.Types.ObjectId.isValid(subCategory) ||
//       !mongoose.Types.ObjectId.isValid(zone) ||
//       !Array.isArray(fields) ||
//       !fields.every((id: string) => mongoose.Types.ObjectId.isValid(id))
//     ) {
//       sendResponse(
//         res,
//         null,
//         "Invalid subCategoryId, zoneId, or fieldsIds",
//         STATUS_CODES.BAD_REQUEST
//       );
//       return;
//     }

//     const subCategoryExists = await SubCategory.findById(subCategory);
//     if (!subCategoryExists) {
//       sendResponse(res, null, "SubCategory not found", STATUS_CODES.NOT_FOUND);
//       return;
//     }

//     const validUserFields = await Field.find({ _id: { $in: fields } });

//     if (validUserFields.length !== fields.length) {
//       sendResponse(res, null, "Some fields are invalid", STATUS_CODES.BAD_REQUEST);
//       return;
//     }

//     const requiredFieldNames = [
//       "name",
//       "subTitle",
//       "description",
//       "price",
//       "priceUnit",
//       "rentalImages",
//     ];

//     const requiredFields = await Field.find({
//       name: { $in: requiredFieldNames },
//     });

//     if (requiredFields.length !== requiredFieldNames.length) {
//       const found = requiredFields.map((f) => f.name);
//       const missing = requiredFieldNames.filter((n) => !found.includes(n));

//       sendResponse(
//         res,
//         null,
//         `Required fields missing in database: ${missing.join(", ")}`,
//         STATUS_CODES.BAD_REQUEST
//       );
//       return;
//     }

//     const fixedFields = await Field.find({ isFixed: true });

//     const allFieldIds: mongoose.Types.ObjectId[] = [
//       ...requiredFields.map((f) => f._id as mongoose.Types.ObjectId),
//       ...fixedFields.map((f) => f._id as mongoose.Types.ObjectId),
//       ...validUserFields.map((f) => f._id as mongoose.Types.ObjectId),
//     ];

//     const uniqueFieldIds = Array.from(
//       new Map(allFieldIds.map((id) => [id.toString(), id])).values()
//     );

//     const form = new Form({
//       name,
//       description,
//       subCategory,
//       zone,
//       fields: uniqueFieldIds,
//       language,
//       setting,
//       userDocuments,
//       leaserDocuments,
//     });

//     await form.save();

//     sendResponse(res, form, "Form created successfully", STATUS_CODES.CREATED);
//   } catch (error) {
//     next(error);
//   }
// };

export const getAllForms = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const lang = (req.query.language || "en").toString().toLowerCase();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const query =
      lang === "en" ? Form.find({}) : Form.find({ "languages.locale": lang });

    const populatedQuery = query
      .populate("fields")
      .populate("zone")
      .populate("subCategory");

    const paginated = await paginateQuery(populatedQuery, { page, limit });

    const localizedForms = paginated.data.map((form) => {
      const formTranslation = form.languages?.find(
        (entry) => entry.locale?.toLowerCase() === lang
      );

      const zone = form.zone as any;
      const zoneTranslation = zone?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      const localizedZone = zone
        ? {
          ...zone,
          name: zoneTranslation?.translations?.name || zone.name,
        }
        : null;

      const subCat = form.subCategory as any;
      const subCatTranslation = subCat?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      const localizedSubCategory = subCat
        ? {
          ...subCat,
          name: subCatTranslation?.translations?.name || subCat.name,
        }
        : null;

      const localizedFields = Array.isArray(form.fields)
        ? (form.fields as any[]).map((field) => {
          const fieldTranslation = field?.languages?.find(
            (entry: any) => entry.locale?.toLowerCase() === lang
          );
          return {
            ...field,
            name: fieldTranslation?.translations?.name || field.name,
            label: fieldTranslation?.translations?.label || field.label,
            placeholder:
              fieldTranslation?.translations?.placeholder ||
              field.placeholder,
          };
        })
        : [];

      return {
        _id: form._id,
        name: formTranslation?.translations?.name || form.name,
        description:
          formTranslation?.translations?.description || form.description,
        fields: localizedFields,
        zone: localizedZone,
        subCategory: localizedSubCategory,
        language: lang,
      };
    });

    sendResponse(
      res,
      {
        forms: localizedForms,
        total: paginated.total,
        page: paginated.page,
        limit: paginated.limit,
      },
      `Forms found for language: ${lang}`,
      STATUS_CODES.OK
    );
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
    const lang = (req.headers["language"] || "en").toString().toLowerCase();

    const form = await Form.findById(req.params.id)
      .populate("fields")
      .populate("zone")
      .populate("subCategory")
      .lean();

    if (!form) {
      sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const formTranslation = form.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );

    const translatedForm: any = {
      ...form,
      name: formTranslation?.translations?.name || form.name,
      description:
        formTranslation?.translations?.description || form.description,
    };

    translatedForm.fields = Array.isArray(form.fields)
      ? (form.fields as any[]).map((field: any) => {
        const fieldTranslation = field.languages?.find(
          (entry: any) => entry.locale?.toLowerCase() === lang
        );
        return {
          ...field,
          name: fieldTranslation?.translations?.name || field.name,
          label: fieldTranslation?.translations?.label || field.label,
          placeholder:
            fieldTranslation?.translations?.placeholder || field.placeholder,
        };
      })
      : [];

    const zone = form.zone as any;
    const zoneTranslation = zone?.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );
    translatedForm.zone = zone
      ? {
        ...zone,
        name: zoneTranslation?.translations?.name || zone?.name || "",
      }
      : null;

    const subCat = form.subCategory as any;
    const subCatTranslation = subCat?.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );
    translatedForm.subCategory = subCat
      ? {
        ...subCat,
        name: subCatTranslation?.translations?.name || subCat?.name || "",
      }
      : null;

    sendResponse(
      res,
      translatedForm,
      `Form details fetched successfully for locale: ${lang}`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const getFormByZoneAndSubCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { zone, subCategory } = req.query;
    const lang = (req.query.language || "en").toString().toLowerCase();

    if (!zone || !subCategory) {
      sendResponse(res, null, "zone and subCategory are required", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const form = await Form.findOne({ zone, subCategory })
      .populate("zone")
      .populate("subCategory")
      .populate({
        path: "fields",
        populate: {
          path: "conditional.dependsOn", // Level 1
          populate: {
            path: "conditional.dependsOn", // Level 2
            populate: {
              path: "conditional.dependsOn", // Level 3
              populate: {
                path: "conditional.dependsOn", // Level 4
                populate: {
                  path: "conditional.dependsOn" // Level 5
                }
              }
            }
          }
        },
      })
      .lean();

    if (!form) {
      sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Localize top-level fields
    const allLocalizedFields = (form.fields as any[]).map((field) => {
      const fieldTranslation = field?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );

      return {
        ...field,
        name: fieldTranslation?.translations?.name || field.name,
        label: fieldTranslation?.translations?.label || field.label,
        placeholder: fieldTranslation?.translations?.placeholder || field.placeholder,
      };
    });

    const dependsOnIds = new Set(
      allLocalizedFields
        .map((f) => f.conditional?.dependsOn?._id?.toString() || f.conditional?.dependsOn?.toString())
        .filter(Boolean)
    );

    const filteredFields = allLocalizedFields.filter(
      (field) => !dependsOnIds.has(field._id.toString())
    );

    const localizedForm = {
      ...form,
      fields: filteredFields,
      language: lang,
    };

    sendResponse(res, localizedForm, "Form fetched successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// UPDATE FORM
export const updateForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { fields = [] } = req.body;

    const form = await Form.findById(id);

    if (!form) {
      sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Maintain frontend order for the IDs we are actually storing
    const userFieldIds = fields.map((fid: string) => new mongoose.Types.ObjectId(fid));

    // Update the form fields with only the top-level selection
    form.fields = userFieldIds;

    await form.save();

    // Fetch the updated form with 5 levels of population for the response
    const updatedForm = await Form.findById(form._id)
      .populate("zone")
      .populate("subCategory")
      .populate({
        path: "fields",
        populate: {
          path: "conditional.dependsOn",
          populate: {
            path: "conditional.dependsOn",
            populate: {
              path: "conditional.dependsOn",
              populate: {
                path: "conditional.dependsOn",
                populate: {
                  path: "conditional.dependsOn"
                }
              }
            }
          }
        },
      });

    sendResponse(res, updatedForm, "Form updated successfully", STATUS_CODES.OK);
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