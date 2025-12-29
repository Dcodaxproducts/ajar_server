import { Request, Response, NextFunction } from "express";
import { Form } from "../models/form.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Field } from "../models/field.model";
import mongoose from "mongoose";
import { SubCategory } from "../models/category.model";
import { paginateQuery } from "../utils/paginate";
import slugify from "slugify";
import { Dropdown } from "../models/dropdown.model";

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
      sendResponse(
        res,
        null,
        "Form name and description are required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    if (
      !mongoose.Types.ObjectId.isValid(subCategory) ||
      !mongoose.Types.ObjectId.isValid(zone) ||
      !Array.isArray(fields) ||
      !fields.every((id: string) => mongoose.Types.ObjectId.isValid(id))
    ) {
      sendResponse(
        res,
        null,
        "Invalid subCategoryId, zoneId, or fieldsIds",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    /**
     * ✅ FORM UNIQUENESS CHECK (zone + subCategory)
     */
    const formAlreadyExists = await Form.findOne({
      subCategory,
      zone,
    });

    if (formAlreadyExists) {
      sendResponse(
        res,
        null,
        "Form already exists for this zone and sub-category",
        STATUS_CODES.CONFLICT
      );
      return;
    }

    const subCategoryExists = await SubCategory.findById(subCategory);
    if (!subCategoryExists) {
      sendResponse(res, null, "SubCategory not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    /**
     * 1️⃣ User selected fields
     */
    const validUserFields = await Field.find({ _id: { $in: fields } });

    if (validUserFields.length !== fields.length) {
      sendResponse(res, null, "Some fields are invalid", STATUS_CODES.BAD_REQUEST);
      return;
    }

    /**
     * 2️⃣ Extract + DEDUPLICATE conditional.dependsOn IDs
     */
    const conditionalFieldIds = Array.from(
      new Set(
        validUserFields
          .map((field) => field.conditional?.dependsOn?.toString())
          .filter(Boolean)
      )
    ).map((id) => new mongoose.Types.ObjectId(id));

    /**
     * 3️⃣ Validate conditional fields (NOW SAFE)
     */
    let conditionalFields: typeof validUserFields = [];
    if (conditionalFieldIds.length > 0) {
      conditionalFields = await Field.find({
        _id: { $in: conditionalFieldIds },
      });

      if (conditionalFields.length !== conditionalFieldIds.length) {
        sendResponse(
          res,
          null,
          "Some conditional fields are invalid",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    /**
     * 4️⃣ Required system fields
     */
    const requiredFieldNames = [
      "name",
      "subTitle",
      "description",
      "price",
      "priceUnit",
      "rentalImages",
    ];

    const requiredFields = await Field.find({
      name: { $in: requiredFieldNames },
    });

    if (requiredFields.length !== requiredFieldNames.length) {
      const found = requiredFields.map((f) => f.name);
      const missing = requiredFieldNames.filter((n) => !found.includes(n));

      sendResponse(
        res,
        null,
        `Required fields missing in database: ${missing.join(", ")}`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    /**
     * 5️⃣ Fixed fields
     */
    const fixedFields = await Field.find({ isFixed: true });

    /**
     * 6️⃣ Merge ALL field IDs (NO DUPLICATES)
     */
    const allFieldIds: mongoose.Types.ObjectId[] = [
      ...requiredFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...fixedFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...validUserFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...conditionalFields.map((f) => f._id as mongoose.Types.ObjectId),
    ];

    const uniqueFieldIds = Array.from(
      new Map(allFieldIds.map((id) => [id.toString(), id])).values()
    );

    /**
     * 7️⃣ Create form
     */
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

    sendResponse(res, form, "Form created successfully", STATUS_CODES.CREATED);
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
      sendResponse(
        res,
        null,
        "zone and subCategory are required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    if (
      !mongoose.Types.ObjectId.isValid(zone.toString()) ||
      !mongoose.Types.ObjectId.isValid(subCategory.toString())
    ) {
      sendResponse(
        res,
        null,
        "Invalid zone or subCategory",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const form = await Form.findOne({
      zone,
      subCategory,
    })
      .populate("fields")
      .populate("zone")
      .populate("subCategory")
      .lean();

    if (!form) {
      sendResponse(
        res,
        null,
        "Form not found for given zone and subcategory",
        STATUS_CODES.NOT_FOUND
      );
      return;
    }

    const formTranslation = form.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );
    const zoneObj = form.zone as any;
    const zoneTranslation = zoneObj?.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );

    const subCat = form.subCategory as any;
    const subCatTranslation = subCat?.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );

    const localizedFields = (form.fields as any[]).map((field) => {
      const fieldTranslation = field?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );

      return {
        ...field,
        name: fieldTranslation?.translations?.name || field.name,
        label: fieldTranslation?.translations?.label || field.label,
        placeholder:
          fieldTranslation?.translations?.placeholder || field.placeholder,
      };
    });

    const localizedForm = {
      ...form,
      name: formTranslation?.translations?.name || form.name,
      description:
        formTranslation?.translations?.description || form.description,
      fields: localizedFields,
      zone: {
        ...zoneObj,
        name: zoneTranslation?.translations?.name || zoneObj.name,
      },
      subCategory: {
        ...subCat,
        name: subCatTranslation?.translations?.name || subCat.name,
      },
      language: lang,
    };

    sendResponse(
      res,
      localizedForm,
      "Form fetched successfully",
      STATUS_CODES.OK
    );
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid form ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const form = await Form.findById(id);
    if (!form) {
      sendResponse(res, null, "Form not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (subCategory && !mongoose.Types.ObjectId.isValid(subCategory)) {
      sendResponse(res, null, "Invalid subCategory ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    if (zone && !mongoose.Types.ObjectId.isValid(zone)) {
      sendResponse(res, null, "Invalid zone ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const requiredFieldNames = [
      "name",
      "subTitle",
      "description",
      "price",
      "priceUnit",
      "rentalImages",
    ];

    const requiredFields = await Field.find({
      name: { $in: requiredFieldNames },
    });

    if (requiredFields.length !== requiredFieldNames.length) {
      const found = requiredFields.map((f) => f.name);
      const missing = requiredFieldNames.filter((n) => !found.includes(n));

      sendResponse(
        res,
        null,
        `Required fields missing in database: ${missing.join(", ")}`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const fixedFields = await Field.find({ isFixed: true });

    let userFieldIds: mongoose.Types.ObjectId[] = [];

    if (Array.isArray(fields) && fields.length > 0) {
      const invalidField = fields.some(
        (fid: string) => !mongoose.Types.ObjectId.isValid(fid)
      );

      if (invalidField) {
        sendResponse(
          res,
          null,
          "Invalid field ID in fields array",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      const validUserFields = await Field.find({ _id: { $in: fields } });

      if (validUserFields.length !== fields.length) {
        sendResponse(
          res,
          null,
          "Some fields are invalid",
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }

      userFieldIds = validUserFields.map(
        (f) => f._id as mongoose.Types.ObjectId
      );
    }

    const allFieldIds: mongoose.Types.ObjectId[] = [
      ...requiredFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...fixedFields.map((f) => f._id as mongoose.Types.ObjectId),
      ...userFieldIds,
    ];

    const uniqueFieldIds = Array.from(
      new Map(allFieldIds.map((id) => [id.toString(), id])).values()
    );

    form.name = name ?? form.name;
    form.description = description ?? form.description;
    form.subCategory = subCategory ?? form.subCategory;
    form.zone = zone ?? form.zone;
    form.fields = uniqueFieldIds;
    form.language = language ?? form.language;
    form.setting = setting ?? form.setting;
    form.userDocuments = userDocuments ?? form.userDocuments;
    form.leaserDocuments = leaserDocuments ?? form.leaserDocuments;

    await form.save();

    sendResponse(res, form, "Form updated successfully", STATUS_CODES.OK);
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
