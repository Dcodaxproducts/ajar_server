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
