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

    const baseQuery = Category.find({
      categoryType: "category",
      language: language,
    }).populate({
      path: "subcategories",
      match: { language },
    });

    const { data, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    sendResponse(
      res,
      {
        categories: data,
        total,
        page: Number(page),
        limit: Number(limit),
      },
      "All categories fetched successfully",
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

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid category ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const category = await Category.findById(id)
      .populate("subcategories")
      .lean();

    if (!category) {
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      category,
      "Category details fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

//Create Category / SubCategory (with description, icon, image)
export const createNewCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      name,
      categoryType,
      categoryId,
      description,
      icon,
      thumbnail,
       language = "en",
    } = req.body;

    const image = req.file ? `/uploads/${req.file.filename}` : undefined;

    let newCategory;

    // If categoryId is passed, treat it as a SubCategory
    if (categoryId) {
      newCategory = new SubCategory({
        name,
        categoryId,
        description,
        icon,
        thumbnail,
        image,
        language,
        // categoryType: "subCategory",
      });
    } else {
      newCategory = new Category({
        name,
        description,
        icon,
        thumbnail,
        image,
        language,
        categoryType: "category",
      });
    }

    await newCategory.save();

    sendResponse(
      res,
      newCategory,
      categoryId
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
      categoryId: parentCategoryId,
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
    existingCategory.categoryId = parentCategoryId || existingCategory.categoryId;
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

    // 🔥 Delete subcategories related to this category
    const subcategories = await SubCategory.find({ categoryId: category._id }) as ICategory[];
    for (const sub of subcategories) {
      // Delete each subcategory thumbnail
      if (sub.thumbnail) {
        const subFilePath = path.join(process.cwd(), sub.thumbnail);
        deleteFile(subFilePath);
      }
      await sub.deleteOne();
    }

    sendResponse(res, category, "Category and related subcategories deleted successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

