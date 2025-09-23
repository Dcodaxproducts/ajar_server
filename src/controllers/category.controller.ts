import { NextFunction, Request, Response } from "express";
import { STATUS_CODES } from "../config/constants";
import { Category, ICategory, SubCategory } from "../models/category.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import path from "path";
import deleteFile from "../utils/deleteFile";
import { paginateQuery } from "../utils/paginate";
import { UserDocument } from "../models/userDocs.model";
import { Form } from "../models/form.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { RefundManagement } from "../models/refundManagement.model";
import { RefundPolicy } from "../models/refundPolicy.model";
import { Zone } from "../models/zone.model";

//Get All Categories with Subcategories
export const getAllCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const language = req.headers["language"]?.toString()?.toLowerCase() || "en";
    const { page = 1, limit = 10, type } = req.query;

    const filter: any = {};
    // Convert type to lowercase for filter
    if (type) filter.type = { $regex: new RegExp(`^${type}$`, "i") }; // Case-insensitive match

    let baseQuery;

    // Convert type to lowercase for comparison
    const typeLower = type?.toString().toLowerCase();

    // 1. If specific type is passed
    if (typeLower === "subcategory") {
      baseQuery = Category.find(filter)
        .populate({ path: "category" })
        .sort({ createdAt: -1 }); // NEW: Show newest subcategories first
    } else if (typeLower === "category") {
      baseQuery = Category.find(filter).sort({ createdAt: -1 }); // NEW: Show newest categories first
    } else {
      // 2. No type filter – show all with subcategory/category relations
      baseQuery = Category.find()
        .populate([{ path: "category" }])
        .sort({ createdAt: -1 }); // NEW: Show newest first
    }

    // Pagination
    const { data, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    const totalCategoriesOnly = await Category.countDocuments(filter);

    const translatedCategories = data.map((cat: any) => {
      const categoryObj = cat.toObject();

      // Translate category
      const catLangMatch = categoryObj.languages?.find(
        (lang: any) => lang.locale === language
      );
      if (catLangMatch?.translations) {
        categoryObj.name = catLangMatch.translations.name || categoryObj.name;
        categoryObj.description =
          catLangMatch.translations.description || categoryObj.description;
      }
      delete categoryObj.languages;

      // Translate subcategories
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

            if (subLangMatch?.translations) {
              subObj.name = subLangMatch.translations.name || subObj.name;
              subObj.description =
                subLangMatch.translations.description || subObj.description;
            }

            delete subObj.languages;
            return subObj;
          }
        );
      } else {
        delete categoryObj.subcategories;
      }

      // Translate parent category if present (for subcategories)
      if (categoryObj.category && typeof categoryObj.category === "object") {
        const parentLang = categoryObj.category.languages?.find(
          (lang: any) => lang.locale === language
        );

        if (parentLang?.translations) {
          categoryObj.category.name =
            parentLang.translations.name || categoryObj.category.name;
          categoryObj.category.description =
            parentLang.translations.description ||
            categoryObj.category.description;
        }
        delete categoryObj.category.languages;
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

// Get Category and Its Subcategories
export const getCategoryWithSubcategories = async (
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
      .populate({
        path: "subcategories",
        model: "SubCategory",
      })
      .lean();

    if (!category) {
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const result: any = { ...category };

    // Apply translation to main category
    const mainLang = category.languages?.find((l) => l.locale === locale);
    if (mainLang?.translations) {
      result.name = mainLang.translations.name || result.name;
      result.description =
        mainLang.translations.description || result.description;
    }
    delete result.languages;

    // Apply translation to subcategories
    if (Array.isArray(result.subcategories)) {
      result.subcategories = result.subcategories.map((sub: any) => {
        const subClone = { ...sub };
        const subLang = subClone.languages?.find(
          (l: any) => l.locale === locale
        );
        if (subLang?.translations) {
          subClone.name = subLang.translations.name || subClone.name;
          subClone.description =
            subLang.translations.description || subClone.description;
        }
        delete subClone.languages;
        return subClone;
      });
    }

    sendResponse(
      res,
      result,
      `Category and its subcategories fetched successfully${
        locale !== "en" ? ` (${locale})` : ""
      }`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Get Category Details
export const getCategoryDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const typeQuery = req.query.type?.toString().toLowerCase();
    const locale = req.headers["language"]?.toString().toLowerCase() || "en";

    // Normalize type value
    const type =
      typeQuery === "categories"
        ? "subCategory"
        : typeQuery === "subcategory"
        ? "category"
        : typeQuery;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Category ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    // === CASE 1: Fetch subcategories of a category ===
    if (type === "category") {
      const category = await Category.findById(id)
        .populate({
          path: "subcategories",
          model: "subCategory",
        })
        .lean();

      if (!category) {
        sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
        return;
      }

      const translatedSubcategories = (category.subcategories || []).map(
        (sub: any) => {
          const translated = { ...sub };
          const lang = translated.languages?.find(
            (l: any) => l.locale === locale
          );
          if (lang?.translations) {
            translated.name = lang.translations.name || translated.name;
            translated.description =
              lang.translations.description || translated.description;
          }
          delete translated.languages;
          return translated;
        }
      );

      sendResponse(
        res,
        translatedSubcategories,
        `Subcategories fetched successfully${
          locale !== "en" ? ` (${locale})` : ""
        }`,
        STATUS_CODES.OK
      );
      return;
    }

    // === CASE 2: Fetch a subcategory and its parent ===
    if (type === "subcategory" || type === "subcategories") {
      const subCategory = await Category.findById(id)
        .populate<{ category: ICategory }>("category")
        .lean();

      if (!subCategory || subCategory.type !== "subCategory") {
        sendResponse(
          res,
          null,
          "Subcategory not found",
          STATUS_CODES.NOT_FOUND
        );
        return;
      }

      const result = { ...subCategory };

      // Translate subcategory
      const lang = result.languages?.find((l: any) => l.locale === locale);
      if (lang?.translations) {
        result.name = lang.translations.name || result.name;
        result.description =
          lang.translations.description || result.description;
      }
      delete result.languages;

      // Translate parent category
      if (result.category && typeof result.category === "object") {
        const parent = { ...result.category };
        const parentLang = parent.languages?.find(
          (l: any) => l.locale === locale
        );
        if (parentLang?.translations) {
          parent.name = parentLang.translations.name || parent.name;
          parent.description =
            parentLang.translations.description || parent.description;
        }
        delete parent.languages;
        result.category = parent;
      }

      sendResponse(
        res,
        result,
        `Subcategory with parent category fetched successfully${
          locale !== "en" ? ` (${locale})` : ""
        }`,
        STATUS_CODES.OK
      );
      return;
    }

    // === DEFAULT CASE: Fetch category or subcategory without type ===
    const category = await Category.findById(id)
      .populate<{ category: ICategory }>("category")
      .lean();

    if (!category) {
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const result = { ...category };

    // Translate current category
    const lang = result.languages?.find((l: any) => l.locale === locale);
    if (lang?.translations) {
      result.name = lang.translations.name || result.name;
      result.description = lang.translations.description || result.description;
    }
    delete result.languages;

    // Translate parent if any
    if (result.category && typeof result.category === "object") {
      const parent = { ...result.category };
      const parentLang = parent.languages?.find(
        (l: any) => l.locale === locale
      );
      if (parentLang?.translations) {
        parent.name = parentLang.translations.name || parent.name;
        parent.description =
          parentLang.translations.description || parent.description;
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

//create new Category or SubCategory
export const createNewCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = (req.files as { [key: string]: Express.Multer.File[] }) || {};
    const { name, type, category, description, language = "en" } = req.body;

    // Handle both single and multiple upload approaches
    const image = req.file
      ? `/uploads/${req.file.filename}`
      : files?.image?.[0]
      ? `/uploads/${files.image[0].filename}`
      : undefined;

    const thumbnail = files?.thumbnail?.[0]
      ? `/uploads/${files.thumbnail[0].filename}`
      : undefined;

    const icon = files?.icon?.[0]
      ? `/uploads/${files.icon[0].filename}`
      : undefined;

    let newCategory;

    if (category) {
      newCategory = new SubCategory({
        name,
        category,
        description,
        icon,
        thumbnail,
        image,
        language,
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

    const savedCategory = await newCategory.save();
    delete savedCategory.id;

    sendResponse(
      res,
      savedCategory,
      category
        ? "Subcategory created successfully"
        : "Category created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    // Clean up any uploaded files on error
    if (req.files) {
      Object.values(req.files).forEach((files) => {
        files.forEach((file: { path: string }) => deleteFile(file.path));
      });
    }
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
      // Clean up any uploaded files if category not found
      if (req.files) {
        const files = req.files as Record<string, Express.Multer.File[]>;
        Object.values(files).forEach((fileArray: Express.Multer.File[]) => {
          fileArray.forEach((file: Express.Multer.File) => {
            deleteFile(file.path);
          });
        });
      }
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

    const files = (req.files as Record<string, Express.Multer.File[]>) || {};

    // Handle image updates and cleanup old files
    const imageFields = ["image", "thumbnail", "icon"] as const;
    imageFields.forEach((field) => {
      if (files?.[field]?.[0]) {
        // Delete old file if exists
        const existingValue = existingCategory.get(field);
        if (existingValue) {
          const oldPath = path.join(process.cwd(), existingValue);
          deleteFile(oldPath);
        }
        // Set new file path
        existingCategory.set(field, `/uploads/${files[field][0].filename}`);
      }
    });

    // Update other fields
    if (name) existingCategory.name = name;
    if (parentCategoryId) existingCategory.category = parentCategoryId;
    if (description) existingCategory.description = description;

    // Handle direct field updates from body (non-file)
    if (icon && !files.icon) existingCategory.icon = icon;
    if (thumbnail && !files.thumbnail) existingCategory.thumbnail = thumbnail;

    await existingCategory.save();

    sendResponse(
      res,
      existingCategory,
      existingCategory.type === "subCategory"
        ? "SubCategory updated successfully"
        : "Category updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    // Clean up any uploaded files on error
    if (req.files) {
      const files = req.files as Record<string, Express.Multer.File[]>;
      Object.values(files).forEach((fileArray: Express.Multer.File[]) => {
        fileArray.forEach((file: Express.Multer.File) => {
          deleteFile(file.path);
        });
      });
    }
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

  // Start a session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const category = await Category.findById(categoryId).session(session);
    if (!category) {
      await session.abortTransaction();
      session.endSession();
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // If it's a main category → delete its subcategories and related records
    if (category.type === "category") {
      const subcategories = await SubCategory.find({
        category: category._id,
      }).session(session);

      for (const sub of subcategories) {
        // Use type assertion for sub._id
        const subId = (sub._id as mongoose.Types.ObjectId).toString();
        await cascadeDeleteSubCategory(subId, session);
        await SubCategory.findByIdAndDelete(sub._id).session(session);
      }

      // Delete user documents linked to this category
      await UserDocument.deleteMany({
        category: category._id,
      }).session(session);
    }

    // If it's a subcategory → delete related records first, then the subcategory
    if (category.type === "subCategory") {
      // Use type assertion for category._id
      const catId = (category._id as mongoose.Types.ObjectId).toString();
      await cascadeDeleteSubCategory(catId, session);
    }

    // Delete category thumbnail if exists
    if (category.thumbnail) {
      const filePath = path.join(process.cwd(), category.thumbnail);
      try {
        deleteFile(filePath);
      } catch (fileError) {
        console.error("Error deleting thumbnail file:", fileError);
        // Continue with deletion even if file deletion fails
      }
    }

    // Finally delete the category itself
    await Category.findByIdAndDelete(categoryId).session(session);

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    sendResponse(
      res,
      null,
      `${category.type} and related records deleted successfully`,
      STATUS_CODES.OK
    );
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();
    console.error("Error deleting category:", error);
    next(error);
  }
};

// Enhanced cascade delete function with transaction support
const cascadeDeleteSubCategory = async (
  subCategoryId: string,
  session: mongoose.ClientSession
) => {
  // Convert string to ObjectId
  const id = new mongoose.Types.ObjectId(subCategoryId);

  console.log(`Cascading delete for subCategory: ${id}`);

  try {
    // 1. First delete Marketplace listings (most important)
    const listingDeleteResult = await MarketplaceListing.deleteMany({
      subCategory: id,
    }).session(session);

    console.log(
      `Deleted ${listingDeleteResult.deletedCount} marketplace listings`
    );

    // Verify deletion by checking if any listings remain
    const remainingListings = await MarketplaceListing.countDocuments({
      subCategory: id,
    }).session(session);

    if (remainingListings > 0) {
      console.warn(
        `WARNING: ${remainingListings} marketplace listings still exist after deletion attempt`
      );

      // Try force deletion with different approach if first attempt failed
      const forceDeleteResult = await MarketplaceListing.deleteMany({
        subCategory: id,
      }).session(session);

      console.log(
        `Force deleted ${forceDeleteResult.deletedCount} additional listings`
      );
    }

    // 2. Delete other related records
    const formDeleteResult = await Form.deleteMany({
      subCategory: id,
    }).session(session);
    console.log(`Deleted ${formDeleteResult.deletedCount} forms`);

    const refundMgmtResult = await RefundManagement.deleteMany({
      subCategory: id,
    }).session(session);
    console.log(
      `Deleted ${refundMgmtResult.deletedCount} refund management records`
    );

    const refundPolicyResult = await RefundPolicy.deleteMany({
      subCategory: id,
    }).session(session);
    console.log(`Deleted ${refundPolicyResult.deletedCount} refund policies`);

    // 3. Pull from Zones
    const zoneUpdateResult = await Zone.updateMany(
      { subCategories: id },
      { $pull: { subCategories: id } },
      { session }
    );
    console.log(`Updated ${zoneUpdateResult.modifiedCount} zones`);
  } catch (error) {
    console.error("Error during cascade delete:", error);
    throw error;
  }
};

// Get Category Names and IDs
export const getCategoryNamesAndIds = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const categories = await Category.find({ type: "category" }).select(
      "name _id"
    );

    sendResponse(
      res,
      categories,
      "Category IDs and names fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Get SubCategory Names and IDs
export const getSubCategoryNamesAndIds = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const subcategories = await Category.find({ type: "subCategory" }).select(
      "name _id"
    );

    sendResponse(
      res,
      subcategories,
      "Subcategory names and IDs fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
