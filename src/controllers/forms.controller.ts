import { Request, Response, NextFunction } from "express";
import { Form } from "../models/form.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Field } from "../models/field.model";
import mongoose from "mongoose";
import { SubCategory } from "../models/category.model";
import { IZone } from "../models/zone.model";
import { ICategory } from "../models/category.model";
import { paginateQuery } from "../utils/paginate";


export const createNewForm = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { subCategory, zone, name, description, fields, language } = req.body;

    // Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(subCategory) ||
      !mongoose.Types.ObjectId.isValid(zone) ||
      !Array.isArray(fields) ||
      !fields.every((id) => mongoose.Types.ObjectId.isValid(id))
    ) {
      sendResponse(res, null, "Invalid subCategoryId, zoneId or fieldsIds", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // Check SubCategory exists
    const subCatExists = await SubCategory.findById(subCategory);
    if (!subCatExists) {
      sendResponse(res, null, "SubCategory not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Optional: Validate that all fieldIds actually exist
    const validFields = await Field.find({ _id: { $in: fields } });
    if (validFields.length !== fields.length) {
      sendResponse(res, null, "One or more fieldIds are invalid", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const { setting } = req.body

    const newForm = await Form.create({
      subCategory,
      zone,
      name,
      description,
      language: language || "en",
      fields,
      setting,
    });

    const populatedForm = await Form.findById(newForm._id).populate("fields").populate("zone")
  .populate("subCategory");

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
    const page = parseInt(req.query.page as string) || 1;     
    const limit = parseInt(req.query.limit as string) || 10;   

    const query = lang === "en"
      ? Form.find({})
      : Form.find({ "languages.locale": lang });

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
                fieldTranslation?.translations?.placeholder || field.placeholder,
            };
          })
        : [];

      return {
        _id: form._id,
        name: formTranslation?.translations?.name || form.name,
        description: formTranslation?.translations?.description || form.description,
        fields: localizedFields,
        zone: localizedZone,
        subCategory: localizedSubCategory,
        language: lang,
      };
    });

    //Send paginated result
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

//   req: Request,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const lang = (req.query.language || "en").toString().toLowerCase();
//     const page = parseInt(req.query.page as string) || 1;      
//     const limit = parseInt(req.query.limit as string) || 10;   

//     const query =
//       lang === "en"
//         ? {}
//         : { "languages.locale": lang };

//     const forms = await Form.find(query)
//       .populate("fields")
//       .populate("zone")
//       .populate("subCategory")
//       .lean();

//        const paginated = await paginateQuery(populatedQuery, { page, limit });

//     const localizedForms = forms.map((form) => {
//       const formTranslation = form.languages?.find(
//         (entry) => entry.locale?.toLowerCase() === lang
//       );  

//       const zone = form.zone as any;
//       const zoneTranslation = zone?.languages?.find(
//         (entry: any) => entry.locale?.toLowerCase() === lang
//       );
//       const localizedZone = zone
//         ? {
//             ...zone,
//             name: zoneTranslation?.translations?.name || zone.name,
//           }
//         : null;

//       const subCat = form.subCategory as any;
//       const subCatTranslation = subCat?.languages?.find(
//         (entry: any) => entry.locale?.toLowerCase() === lang
//       );
//       const localizedSubCategory = subCat
//         ? {
//             ...subCat,
//             name: subCatTranslation?.translations?.name || subCat.name,
//           }
//         : null;

//       const localizedFields = Array.isArray(form.fields)
//         ? (form.fields as any[]).map((field) => {
//             const fieldTranslation = field?.languages?.find(
//               (entry: any) => entry.locale?.toLowerCase() === lang
//             );
//             return {
//               ...field,
//               name: fieldTranslation?.translations?.name || field.name,
//               label: fieldTranslation?.translations?.label || field.label,
//               placeholder: fieldTranslation?.translations?.placeholder || field.placeholder,
//             };
//           })
//         : [];

//       return {
//         _id: form._id,
//         name: formTranslation?.translations?.name || form.name,
//         description: formTranslation?.translations?.description || form.description,
//         fields: localizedFields,
//         zone: localizedZone,
//         subCategory: localizedSubCategory,
//         language: lang,
//       };
//     });

//     sendResponse(res,  {
//         forms: localizedForms,
//         total: paginated.total,
//         page: paginated.page,
//         limit: paginated.limit,
//       }, `Forms found for language: ${lang}`, STATUS_CODES.OK);
//   } catch (error) {
//     next(error);
//   }
// };

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
      description: formTranslation?.translations?.description || form.description,
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
            placeholder: fieldTranslation?.translations?.placeholder || field.placeholder,
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

    if (
      !mongoose.Types.ObjectId.isValid(zone.toString()) ||
      !mongoose.Types.ObjectId.isValid(subCategory.toString())
    ) {
      sendResponse(res, null, "Invalid zone or subCategory", STATUS_CODES.BAD_REQUEST);
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
      sendResponse(res, null, "Form not found for given zone and subcategory", STATUS_CODES.NOT_FOUND);
      return;
    }

    const formTranslation = form.languages?.find((entry: any) => entry.locale?.toLowerCase() === lang);
    const zoneObj = form.zone as any;
    const zoneTranslation = zoneObj?.languages?.find((entry: any) => entry.locale?.toLowerCase() === lang);

    const subCat = form.subCategory as any;
    const subCatTranslation = subCat?.languages?.find((entry: any) => entry.locale?.toLowerCase() === lang);

    const localizedFields = (form.fields as any[]).map((field) => {
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
