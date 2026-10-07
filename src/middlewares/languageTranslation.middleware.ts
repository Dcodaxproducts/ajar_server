import { Request, Response, NextFunction } from "express";
import mongoose, { Model } from "mongoose";
import { normalizeLocale } from "../utils/locale";

type TranslationValue =
  | string
  | string[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

export type PendingTranslation = {
  locale: string;
  translations: Record<string, unknown>;
};

const TRANSLATABLE_FIELDS: Record<string, readonly string[]> = {
  Form: ["name", "description"],
  Field: [
    "name",
    "label",
    "placeholder",
    "tooltip",
    "validationError",
    "validation",
    "options",
    "documentConfig",
  ],
  Category: ["name", "description"],
  subCategory: ["name", "description"],
  Zone: ["name", "adminNotes"],
  FAQ: ["question", "answer"],
  MarketplaceListing: ["name", "subTitle", "description", "address"],
  Employee: ["name", "address"],
  EmployeeManagement: ["name", "address"],
  BusinessSetting: ["pageSettings"],
};

const hasTranslationContent = (value: unknown): value is TranslationValue => {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
};

const sanitizeTranslationValue = (key: string, value: unknown): unknown => {
  if (key === "validation") {
    const validation = value as Record<string, unknown> | undefined;
    return validation && typeof validation.error === "string"
      ? { error: validation.error }
      : undefined;
  }
  return hasTranslationContent(value) ? value : undefined;
};

export const extractTranslatableFields = (
  modelName: string,
  body: Record<string, unknown>
): Record<string, unknown> => {
  const allowed = new Set(TRANSLATABLE_FIELDS[modelName] || []);
  return Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, sanitizeTranslationValue(key, value)])
      .filter(([, value]) => value !== undefined)
  );
};

export const languageTranslationMiddleware = <T>(model: Model<T>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const rawLocale = req.body.locale;
    const locale = normalizeLocale(rawLocale);

    if (!rawLocale || locale === "en") return next();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: req.t("common:invalidIdFormat") });
    }

    try {
      const translatableFields = extractTranslatableFields(
        model.modelName,
        req.body as Record<string, unknown>
      );

      delete req.body.locale;
      for (const key of Object.keys(translatableFields)) delete req.body[key];

      if (Object.keys(translatableFields).length === 0) {
        if (Object.keys(req.body).length > 0) return next();
        return res.status(400).json({ message: req.t("common:noTranslatableFields") });
      }

      // Form patches can contain both translated and structural fields. Stage the
      // translation so updateForm validates everything and persists one document once.
      if (model.modelName === "Form") {
        res.locals.pendingTranslation = {
          locale,
          translations: translatableFields,
        } satisfies PendingTranslation;
        return next();
      }

      const doc = await model.findById(id);
      if (!doc) {
        return res
          .status(404)
          .json({ message: req.t("common:modelNotFound", { model: model.modelName }) });
      }

      const translatedDoc = doc as typeof doc & {
        languages?: Array<{
          locale: string;
          translations: Record<string, unknown>;
        }>;
      };
      if (!Array.isArray(translatedDoc.languages)) translatedDoc.languages = [];

      const existingLang = translatedDoc.languages.find(
        (entry) => entry.locale.toLowerCase() === locale
      );
      if (existingLang) {
        existingLang.translations = {
          ...existingLang.translations,
          ...translatableFields,
        };
      } else {
        translatedDoc.languages.push({ locale, translations: translatableFields });
      }

      await doc.save();

      if (Object.keys(req.body).length === 0) {
        return res.status(200).json({
          success: true,
          message: req.t("common:translationSaved", {
            model: model.modelName,
            locale,
          }),
          data: doc,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
