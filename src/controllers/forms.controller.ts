import { Request, Response, NextFunction } from "express";
import { Form } from "../models/form.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Field } from "../models/field.model";
import mongoose from "mongoose";
import { paginateQuery } from "../utils/paginate";
import { Dropdown } from "../models/dropdown.model";
import { resolveRequestLocale } from "../utils/locale";
import {
  localizeDropdownValue,
  localizeField,
  localizeNamedRecord,
  preserveCanonicalFieldOrder,
  translationFor,
} from "../utils/formLocalization";

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
      sendResponse(res, null, req.t("catalog:form.nameAndDescriptionRequired"), STATUS_CODES.BAD_REQUEST);
      return
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(subCategory) || !mongoose.Types.ObjectId.isValid(zone)) {
      sendResponse(res, null, req.t("catalog:form.invalidZoneOrSubCategory"), STATUS_CODES.BAD_REQUEST);
      return
    }

    // 1. Check Uniqueness
    const formAlreadyExists = await Form.findOne({ subCategory, zone });
    if (formAlreadyExists) {
      sendResponse(res, null, req.t("catalog:form.alreadyExists"), STATUS_CODES.CONFLICT);
      return
    }

    if (
      !Array.isArray(fields) ||
      !fields.every((fieldId: unknown) =>
        mongoose.Types.ObjectId.isValid(String(fieldId))
      ) ||
      new Set(fields.map((fieldId: unknown) => String(fieldId))).size !== fields.length
    ) {
      sendResponse(res, null, req.t("catalog:form.invalidFields"), STATUS_CODES.BAD_REQUEST);
      return;
    }

    // 2. Validate user-selected fields while retaining the request sequence.
    const validUserFieldsRaw = await Field.find({ _id: { $in: fields } });
    if (validUserFieldsRaw.length !== fields.length) {
      sendResponse(res, null, req.t("catalog:form.someSelectedFieldsInvalid"), STATUS_CODES.BAD_REQUEST);
      return
    }

    // Map IDs to maintain the exact order sent by frontend
    const userFieldIds = fields.map((id: string) => new mongoose.Types.ObjectId(id));

    // 3. Required system fields
    const requiredFieldNames = ["name", "subTitle", "description", "price", "priceUnit", "rentalImages", "location","unavailability","dynamicPricing"];
    const requiredFieldsRaw = await Field.find({ name: { $in: requiredFieldNames } });
    const requiredFieldsByName = new Map(
      requiredFieldsRaw.map((field) => [field.name, field] as const)
    );
    const requiredFields = requiredFieldNames
      .map((fieldName) => requiredFieldsByName.get(fieldName))
      .filter((field): field is NonNullable<typeof field> => Boolean(field));

    if (requiredFields.length !== requiredFieldNames.length) {
      sendResponse(res, null, req.t("catalog:form.systemFieldsMissing"), STATUS_CODES.BAD_REQUEST);
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

    sendResponse(res, populatedForm, req.t("catalog:form.created"), STATUS_CODES.CREATED);
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
//       sendResponse(res, null, req.t("catalog:form.subCategoryNotFound"), STATUS_CODES.NOT_FOUND);
//       return;
//     }

//     const validUserFields = await Field.find({ _id: { $in: fields } });

//     if (validUserFields.length !== fields.length) {
//       sendResponse(res, null, req.t("catalog:form.someFieldsInvalid"), STATUS_CODES.BAD_REQUEST);
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

//     sendResponse(res, form, req.t("catalog:form.created"), STATUS_CODES.CREATED);
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
    const lang = resolveRequestLocale(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    // Missing translations fall back to English; they never hide valid forms.
    const query = Form.find({});

    const populatedQuery = query
      .populate("fields")
      .populate("zone")
      .populate("subCategory");

    const paginated = await paginateQuery(populatedQuery, { page, limit });

    const localizedForms = paginated.data.map((form) => {
      const formObject = form.toObject() as any;
      const formTranslation = form.languages?.find(
        (entry) => entry.locale?.toLowerCase() === lang
      );

      const zone = formObject.zone as any;
      const zoneTranslation = zone?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      const localizedZone = zone
        ? {
          ...zone,
          name: zoneTranslation?.translations?.name || zone.name,
        }
        : null;

      const subCat = formObject.subCategory as any;
      const subCatTranslation = subCat?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      const localizedSubCategory = subCat
        ? {
          ...subCat,
          name: subCatTranslation?.translations?.name || subCat.name,
        }
        : null;

      const localizedFields = Array.isArray(formObject.fields)
        ? formObject.fields.map((field: any) => localizeField(field, lang))
        : [];

      return {
        ...formObject,
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
      req.t("catalog:form.listFetched"),
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
    const lang = resolveRequestLocale(req);

    const form = await Form.findById(req.params.id)
      .populate("fields")
      .populate("zone")
      .populate({ path: "subCategory", populate: { path: "category" } })
      .lean();

    if (!form) {
      sendResponse(res, null, req.t("catalog:form.notFound"), STATUS_CODES.NOT_FOUND);
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
      ? (form.fields as any[]).map((field: any) => localizeField(field, lang))
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
    translatedForm.subCategory = subCat
      ? localizeNamedRecord(subCat, lang)
      : null;

    sendResponse(
      res,
      translatedForm,
      req.t("catalog:form.detailsFetched"),
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
    const lang = resolveRequestLocale(req);

    if (!zone || !subCategory) {
      sendResponse(
        res,
        null,
        req.t("catalog:form.zoneAndSubCategoryRequired"),
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const formDocument = await Form.findOne({ zone, subCategory })
      .populate("zone")
      .populate({
        path: "subCategory",
        populate: { path: "category" },
      })
      .populate({
        path: "fields",
        populate: {
          path: "conditional.dependsOn",
          populate: [
            {
              path: "conditional.dependsOn",
              populate: {
                path: "conditional.dependsOn",
                populate: {
                  path: "conditional.dependsOn",
                  populate: { path: "conditional.dependsOn" },
                },
              },
            },
          ],
        },
      });

    if (!formDocument) {
      sendResponse(res, null, req.t("catalog:form.notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    const canonicalFieldIds =
      (formDocument.populated("fields") as mongoose.Types.ObjectId[] | undefined) ||
      formDocument.fields;
    const form = formDocument.toObject() as any;
    const orderedFields = preserveCanonicalFieldOrder(
      canonicalFieldIds,
      Array.isArray(form.fields) ? form.fields : []
    );
    const formTranslation = translationFor(form, lang);

    const rawUserDocs: string[] = form.userDocuments || [];
    const rawLeaserDocs: string[] = form.leaserDocuments || [];
    const [userDropdown, leaserDropdown] = await Promise.all([
      Dropdown.findOne({ name: "userDocuments" }).lean(),
      Dropdown.findOne({ name: "leaserDocuments" }).lean(),
    ]);

    const mapDocs = (keys: string[], dropdown: any) => {
      const values = dropdown?.values || [];
      const dropdownTranslation = translationFor(dropdown, lang);
      return keys.map((key) => {
        const match = values.find((value: any) => value.value === key);
        const fallback = {
          value: key,
          name: key,
          hasExpiry: false,
          autoApproval: false,
        };
        return localizeDropdownValue(match || fallback, lang, dropdownTranslation);
      });
    };

    const localizedForm = {
      ...form,
      name:
        (typeof formTranslation.name === "string" && formTranslation.name) ||
        form.name,
      description:
        (typeof formTranslation.description === "string" &&
          formTranslation.description) ||
        form.description,
      fields: orderedFields.map((field: any) => localizeField(field, lang)),
      zone: localizeNamedRecord(form.zone, lang),
      subCategory: localizeNamedRecord(form.subCategory, lang),
      language: lang,
      userDocuments: mapDocs(rawUserDocs, userDropdown),
      leaserDocuments: mapDocs(rawLeaserDocs, leaserDropdown),
    };

    sendResponse(res, localizedForm, req.t("catalog:form.fetched"), STATUS_CODES.OK);
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
      fields,
      userDocuments,
      leaserDocuments,
      setting,
      name,
      description,
      zone,
      subCategory,
    } = req.body;
    const hasOwn = (key: string) =>
      Object.prototype.hasOwnProperty.call(req.body, key);

    const form = await Form.findById(id);

    if (!form) {
      sendResponse(res, null, req.t("catalog:form.notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    // Form.fields is the canonical template-specific sequence. Only replace it
    // when explicitly supplied, and never derive it from global Field.order.
    if (hasOwn("fields")) {
      if (
        !Array.isArray(fields) ||
        !fields.every((fieldId: unknown) =>
          mongoose.Types.ObjectId.isValid(String(fieldId))
        ) ||
        new Set(fields.map((fieldId: unknown) => String(fieldId))).size !== fields.length
      ) {
        sendResponse(res, null, req.t("catalog:form.invalidFields"), STATUS_CODES.BAD_REQUEST);
        return;
      }

      const fieldIds = fields.map((fieldId: unknown) => String(fieldId));
      const existingFieldCount = await Field.countDocuments({ _id: { $in: fieldIds } });
      if (existingFieldCount !== fieldIds.length) {
        sendResponse(res, null, req.t("catalog:form.someSelectedFieldsInvalid"), STATUS_CODES.BAD_REQUEST);
        return;
      }
      form.fields = fieldIds.map((fieldId) => new mongoose.Types.ObjectId(fieldId));
    }

    if (hasOwn("userDocuments")) {
      if (!Array.isArray(userDocuments)) {
        sendResponse(res, null, req.t("catalog:form.invalidDocuments"), STATUS_CODES.BAD_REQUEST);
        return;
      }
      form.userDocuments = userDocuments;
    }
    if (hasOwn("leaserDocuments")) {
      if (!Array.isArray(leaserDocuments)) {
        sendResponse(res, null, req.t("catalog:form.invalidDocuments"), STATUS_CODES.BAD_REQUEST);
        return;
      }
      form.leaserDocuments = leaserDocuments;
    }

    if (hasOwn("setting")) form.setting = setting;
    if (hasOwn("name")) form.name = name;
    if (hasOwn("description")) form.description = description;
    if (hasOwn("zone")) {
      if (!mongoose.Types.ObjectId.isValid(String(zone))) {
        sendResponse(res, null, req.t("catalog:form.invalidZoneOrSubCategory"), STATUS_CODES.BAD_REQUEST);
        return;
      }
      form.zone = new mongoose.Types.ObjectId(zone);
    }
    if (hasOwn("subCategory")) {
      if (!mongoose.Types.ObjectId.isValid(String(subCategory))) {
        sendResponse(res, null, req.t("catalog:form.invalidZoneOrSubCategory"), STATUS_CODES.BAD_REQUEST);
        return;
      }
      form.subCategory = new mongoose.Types.ObjectId(subCategory);
    }

    // Save the changes
    await form.save();

    // Fetch the updated form with population for the response
    const updatedForm = await Form.findById(form._id)
      .populate("zone")
      .populate("subCategory")
      .populate({
        path: "fields",
        populate: {
          path: "conditional.dependsOn",
          // ... (keep your existing nested population)
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
          }
        },
      });

    sendResponse(res, updatedForm, req.t("catalog:form.updated"), STATUS_CODES.OK);
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
      sendResponse(res, null, req.t("catalog:form.notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }
    sendResponse(res, null, req.t("catalog:form.deleted"), STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
