// import { Request, Response, NextFunction } from "express";
// import mongoose from "mongoose";
// import { Field } from "../models/field.model";

// export const languageTranslationMiddleware = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   const { id } = req.params;
//   const { locale, name, label, placeholder } = req.body;

//   if (!locale || locale === "en") return next();

//   if (!mongoose.Types.ObjectId.isValid(id)) {
//     return res.status(400).json({ message: "Invalid ID format" });
//   }

//   try {
//     const field = await Field.findById(id);

//     if (!field) {
//       return res.status(404).json({ message: "Field not found" });
//     }

//     const newTranslation = {
//       ...(name && { name }),
//       ...(label && { label }),
//       ...(placeholder && { placeholder }),
//     };

//     if (!Array.isArray(field.languages)) {
//       field.languages = [];
//     }

//     const existingLang = field.languages.find((lang) => lang.locale === locale);

//     if (existingLang) {
//       existingLang.translations = {
//         ...existingLang.translations,
//         ...newTranslation,
//       };
//     } else {
//       field.languages.push({
//         locale,
//         translations: newTranslation,
//       });
//     }

//     await field.save();

//     return res.status(200).json({
//       success: true,
//       message: "Translation saved",
//       data: field,
//     });
//   } catch (error) {
//     next(error);
//   }
// };
 





// middlewares/translation.middleware.ts
import { Request, Response, NextFunction } from "express";
import mongoose, { Model } from "mongoose";

export const languageTranslationMiddleware = (model: Model<any>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { locale, ...fieldsToTranslate } = req.body;

    if (!locale || locale === "en") return next();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    try {
      const doc = await model.findById(id);
      if (!doc) {
        return res.status(404).json({ message: `${model.modelName} not found` });
      }

      const translatableFields = { ...fieldsToTranslate };

      if (!Array.isArray(doc.languages)) {
        doc.languages = [];
      }

      const existingLang = doc.languages.find((lang: any) => lang.locale === locale);

      if (existingLang) {
        existingLang.translations = {
          ...existingLang.translations,
          ...translatableFields,
        };
      } else {
        doc.languages.push({
          locale,
          translations: translatableFields,
        });
      }

      await doc.save();

      return res.status(200).json({
        success: true,
        message: `${model.modelName} translation saved`,
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  };
};
