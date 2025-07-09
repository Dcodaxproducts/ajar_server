import { NextFunction, Request, Response } from "express";
import { STATUS_CODES } from "../config/constants";
import { Category, ICategory, SubCategory } from "../models/category.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import path from "path";
import deleteFile from "../utils/deleteFile";
import { paginateQuery } from "../utils/paginate";

//Get All Categories with Subcategories
export const getAllCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const language = req.headers["language"]?.toString() || "en";
    const { page = 1, limit = 10 } = req.query;

    const baseQuery = Category.find({ type: "category" }).populate({
      path: "subcategories",
    });

    const { data, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    const totalCategoriesOnly = await Category.countDocuments({ type: "category" });


    const translatedCategories = data.map((cat: any) => {
      const categoryObj = cat.toObject();

      // Find language match for category
      const catLangMatch = categoryObj.languages?.find(
        (lang: any) => lang.locale === language
      );

      // If language match exists, apply translation
      if (catLangMatch?.translations) {
        categoryObj.name = catLangMatch.translations.name || categoryObj.name;
        categoryObj.description =
          catLangMatch.translations.description || categoryObj.description;
      }

      // Process subcategories
      if (Array.isArray(categoryObj.subcategories)) {
        categoryObj.subcategories = categoryObj.subcategories.map(
          (sub: any) => {
            const subObj =
              typeof sub.toObject === "function"
                ? sub.toObject()
                : JSON.parse(JSON.stringify(sub));

            const subLangMatch = subObj.languages?.find(
              (lang: any) => lang.locale === language
            );

            // If subcategory has the requested language, translate
            if (subLangMatch?.translations) {
              subObj.name = subLangMatch.translations.name || subObj.name;
              subObj.description =
                subLangMatch.translations.description || subObj.description;
            }

            delete subObj.languages;
            return subObj;
          }
        );
      }

      // Remove category language if it wasn't matched to avoid showing wrong language
      if (!catLangMatch?.translations) {
        // Keep original name and description (default language), but remove other langs
        delete categoryObj.languages;
      } else {
        delete categoryObj.languages;
      }

      return categoryObj;
    });

    sendResponse(
      res,
      {
        categories: translatedCategories,
        total,
        totalCategories: totalCategoriesOnly,
        page: Number(page),
        limit: Number(limit),
      },
      `Categories fetched successfully${
        language ? ` (locale: ${language})` : ""
      }`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

//Get Category Details
export const getCategoryDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const locale = req.headers["language"]?.toString()?.toLowerCase() || "en";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Category ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const category = await Category.findById(id)
      .populate<{ category: ICategory }>("category") //Properly typed populate
      .lean()
      .exec();

    if (!category) {
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const result: any = { ...category };

    // Apply translation to current category
    if (locale !== "en" && category.languages?.length) {
      const lang = category.languages.find((l) => l.locale === locale);
      if (lang?.translations) {
        result.name = lang.translations.name || result.name;
        result.description =
          lang.translations.description || result.description;
      }
    }

    delete result.languages;

    // Apply translation to parent category if it exists
    if (result.category && typeof result.category === "object") {
      const parent = { ...result.category };

      if (parent.languages?.length) {
        const parentLang = parent.languages.find(
          (l: any) => l.locale === locale
        );
        if (parentLang?.translations) {
          parent.name = parentLang.translations.name || parent.name;
          parent.description =
            parentLang.translations.description || parent.description;
        }
      }

      delete parent.languages;
      result.category = parent;
    }

    sendResponse(
      res,
      result,
      `Category details fetched successfully${
        locale !== "en" ? ` (${locale})` : ""
      }`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const createNewCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      name,
      type,
      category,
      description,
      icon,
      thumbnail,
      language = "en",
    } = req.body;

    const image = req.file ? `/uploads/${req.file.filename}` : undefined;

    let newCategory;

    // If categoryId is passed, treat it as a SubCategory
    if (category) {
      newCategory = new SubCategory({
        name,
        category,
        description,
        icon,
        thumbnail,
        image,
        language,
        // type: "subCategory",
      });
    } else {
      newCategory = new Category({
        name,
        description,
        icon,
        thumbnail,
        image,
        language,
        type: "category",
      });
    }

    await newCategory.save();

    sendResponse(
      res,
      newCategory,
      category
        ? "Subcategory created successfully"
        : "Category created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

//Update Category / SubCategory
export const updateCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const categoryId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    sendResponse(res, null, "Invalid Category ID", STATUS_CODES.BAD_REQUEST);
    return;
  }

  try {
    const existingCategory = await Category.findById(categoryId);
    if (!existingCategory) {
      if (req.file) deleteFile(req.file.path);
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const {
      name,
      category: parentCategoryId,
      description,
      icon,
      thumbnail,
    } = req.body;

    let image = existingCategory.image;
    if (req.file) {
      if (existingCategory.image) {
        const oldPath = path.join(process.cwd(), existingCategory.image);
        deleteFile(oldPath);
      }
      image = `/uploads/${req.file.filename}`;
    }

    //Update fields
    existingCategory.name = name || existingCategory.name;
    existingCategory.category = parentCategoryId || existingCategory.category;
    existingCategory.description = description || existingCategory.description;
    existingCategory.icon = icon || existingCategory.icon;
    existingCategory.thumbnail = thumbnail || existingCategory.thumbnail;

    existingCategory.image = image;

    await existingCategory.save();

    sendResponse(
      res,
      existingCategory,
      "Category updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    if (req.file) deleteFile(req.file.path);
    next(error);
  }
};

//Update only image
export const updateCategoryThumbnail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const categoryId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    if (req.file) deleteFile(req.file.path);
    sendResponse(res, null, "Invalid Category ID", STATUS_CODES.BAD_REQUEST);
    return;
  }

  try {
    const category = await Category.findById(categoryId);
    if (!category) {
      if (req.file) deleteFile(req.file.path);
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (!req.file) {
      sendResponse(res, null, "No file uploaded", STATUS_CODES.BAD_REQUEST);
      return;
    }

    if (category.image) {
      const oldFilePath = path.join(process.cwd(), category.image);
      deleteFile(oldFilePath);
    }

    category.image = `/uploads/${req.file.filename}`;
    await category.save();

    sendResponse(res, category, "Image updated successfully", STATUS_CODES.OK);
  } catch (error) {
    if (req.file) deleteFile(req.file.path);
    next(error);
  }
};

//Delete Category or Subcategory
export const deleteCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const categoryId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    sendResponse(res, null, "Invalid Category ID", STATUS_CODES.BAD_REQUEST);
    return;
  }

  try {
    const category = await Category.findByIdAndDelete(categoryId);
    if (!category) {
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Delete thumbnail if it exists
    if (category.thumbnail) {
      const filePath = path.join(process.cwd(), category.thumbnail);
      deleteFile(filePath);
    }

    //Delete subcategories related to this category
    const subcategories = (await SubCategory.find({
      category: category._id,
    })) as ICategory[];
    for (const sub of subcategories) {
      // Delete each subcategory thumbnail
      if (sub.thumbnail) {
        const subFilePath = path.join(process.cwd(), sub.thumbnail);
        deleteFile(subFilePath);
      }
      await sub.deleteOne();
    }

    sendResponse(
      res,
      category,
      "Category and related subcategories deleted successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
