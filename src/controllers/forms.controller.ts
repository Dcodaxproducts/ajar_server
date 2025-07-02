import { Request, Response, NextFunction } from "express";
import { Form } from "../models/form.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Field } from "../models/field.model";
import mongoose from "mongoose";
import { SubCategory } from "../models/category.model";
import { IZone } from "../models/zone.model";
import { ICategory } from "../models/category.model";


export const createNewForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { subCategoryId, zoneId, name, description, fieldsIds, language } = req.body;

    // Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(subCategoryId) ||
      !mongoose.Types.ObjectId.isValid(zoneId) ||
      !Array.isArray(fieldsIds) ||
      !fieldsIds.every((id) => mongoose.Types.ObjectId.isValid(id))
    ) {
      sendResponse(res, null, "Invalid subCategoryId, zoneId or fieldsIds", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Check SubCategory exists
    const subCatExists = await SubCategory.findById(subCategoryId);
    if (!subCatExists) {
      sendResponse(res, null, "SubCategory not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Optional: Validate that all fieldIds actually exist
    const validFields = await Field.find({ _id: { $in: fieldsIds } });
    if (validFields.length !== fieldsIds.length) {
      sendResponse(res, null, "One or more fieldIds are invalid", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const newForm = await Form.create({
      subCategoryId,
      zoneId,
      name,
      description,
      language: language || "en",
      fieldsIds,
    });

    const populatedForm = await Form.findById(newForm._id).populate("fieldsIds").populate("zoneId")
  .populate("subCategoryId");

    sendResponse(res, populatedForm, "Form created successfully", STATUS_CODES.CREATED);
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
    const lang = (req.query.language || "en").toString().toLowerCase();

    const forms = await Form.find({
      "languages.locale": lang
    })
      .populate("fieldsIds")
      .populate("zoneId")
      .populate("subCategoryId")
      .lean();

    const localizedForms = forms.map((form) => {
      const formTranslation = form.languages?.find(
        (entry) => entry.locale?.toLowerCase() === lang
      );

      const zone = form.zoneId as any;
      const zoneTranslation = zone?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      const localizedZone = zone
        ? {
            ...zone,
            name: zoneTranslation?.translations?.name || zone.name,
          }
        : null;

      const subCat = form.subCategoryId as any;
      const subCatTranslation = subCat?.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      const localizedSubCategory = subCat
        ? {
            ...subCat,
            name: subCatTranslation?.translations?.name || subCat.name,
          }
        : null;

      const localizedFields = (form.fieldsIds as any[]).map((field) => {
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

      return {
        _id: form._id,
        name: formTranslation?.translations?.name || form.name,
        description: formTranslation?.translations?.description || form.description,
        fieldsIds: localizedFields,
        zoneId: localizedZone,
        subCategoryId: localizedSubCategory,
        language: lang,
      };
    });

    sendResponse(res, localizedForms, `Forms found for language: ${lang}`, STATUS_CODES.OK);
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
      .populate("fieldsIds")
      .populate("zoneId")
      .populate("subCategoryId")
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
      description: formTranslation?.translations?.description || form.description,
    };

    translatedForm.fieldsIds = (form.fieldsIds as any[]).map((field: any) => {
      const fieldTranslation = field.languages?.find(
        (entry: any) => entry.locale?.toLowerCase() === lang
      );
      return {
        ...field,
        name: fieldTranslation?.translations?.name || field.name,
        label: fieldTranslation?.translations?.label || field.label,
        placeholder: fieldTranslation?.translations?.placeholder || field.placeholder,
      };
    });

    // 🛠 Zone safe-check
    const zone = form.zoneId as any;
    const zoneTranslation = zone?.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );
    translatedForm.zoneId = zone
      ? {
          ...zone,
          name: zoneTranslation?.translations?.name || zone?.name || "",
        }
      : null;

    // 🛠 SubCategory safe-check
    const subCat = form.subCategoryId as any;
    const subCatTranslation = subCat?.languages?.find(
      (entry: any) => entry.locale?.toLowerCase() === lang
    );
    translatedForm.subCategoryId = subCat
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

// controllers/form.controller.ts
export const getFormByZoneAndSubCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { zoneId, subCategoryId } = req.query;
    const lang = (req.query.language || "en").toString().toLowerCase();

    if (!zoneId || !subCategoryId) {
      sendResponse(res, null, "zoneId and subCategoryId are required", STATUS_CODES.BAD_REQUEST);
      return;
    }

    if (
      !mongoose.Types.ObjectId.isValid(zoneId.toString()) ||
      !mongoose.Types.ObjectId.isValid(subCategoryId.toString())
    ) {
      sendResponse(res, null, "Invalid zoneId or subCategoryId", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const form = await Form.findOne({
      zoneId,
      subCategoryId,
    })
      .populate("fieldsIds")
      .populate("zoneId")
      .populate("subCategoryId")
      .lean();

    if (!form) {
      sendResponse(res, null, "Form not found for given zone and subcategory", STATUS_CODES.NOT_FOUND);
      return;
    }

    const formTranslation = form.languages?.find((entry: any) => entry.locale?.toLowerCase() === lang);
    const zone = form.zoneId as any;
    const zoneTranslation = zone?.languages?.find((entry: any) => entry.locale?.toLowerCase() === lang);

    const subCat = form.subCategoryId as any;
    const subCatTranslation = subCat?.languages?.find((entry: any) => entry.locale?.toLowerCase() === lang);

    const localizedFields = (form.fieldsIds as any[]).map((field) => {
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

    const localizedForm = {
      ...form,
      name: formTranslation?.translations?.name || form.name,
      description: formTranslation?.translations?.description || form.description,
      fieldsIds: localizedFields,
      zoneId: {
        ...zone,
        name: zoneTranslation?.translations?.name || zone.name,
      },
      subCategoryId: {
        ...subCat,
        name: subCatTranslation?.translations?.name || subCat.name,
      },
      language: lang,
    };

    sendResponse(res, localizedForm, "Form fetched successfully", STATUS_CODES.OK);
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
