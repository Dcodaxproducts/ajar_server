// middlewares/languageTranslation.middleware.ts
import { Request, Response, NextFunction } from "express";
import mongoose, { Model } from "mongoose";

export const languageTranslationMiddleware = (model: Model<any>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { locale, ...rest } = req.body;

    if (!locale || locale === "en") return next(); // Skip if no locale or default locale

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    try {
      const doc = await model.findById(id);
      if (!doc) {
        return res.status(404).json({ message: `${model.modelName} not found` });
      }

      if (!Array.isArray(doc.languages)) {
        doc.languages = [];
      }

      // Filter translation fields (everything except locale)
      const translatableFields = { ...rest };

      if (Object.keys(translatableFields).length === 0) {
        return res.status(400).json({ message: "No translatable fields provided" });
      }

      // Remove translated fields from req.body so controller won’t process them again
      for (const key of Object.keys(translatableFields)) {
        delete req.body[key];
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

      // Return response directly if only translation fields were passed
      if (Object.keys(req.body).length === 0) {
        return res.status(200).json({
          success: true,
          message: `${model.modelName} translation saved for locale "${locale}"`,
          data: doc,
        });
      }

      // Proceed to controller if other fields exist
      next();
    } catch (error) {
      next(error);
    }
  };
};
