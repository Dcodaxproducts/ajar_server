import { NextFunction, Request, Response } from "express";
import { STATUS_CODES } from "../config/constants";
import { Category } from "../models/category.model";
import { Field } from "../models/field.model";
import { sendResponse } from "../utils/response";
import mongoose from "mongoose";
import path from "path";
import deleteFile from "../utils/deleteFile";

// Get All Categories
export const getAllCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let query: any = {};
    const { zoneId } = req.query || {};
    if (zoneId) {
      query.zoneId = zoneId;
    }
    console.log(query, "query");
    const categories = await Category.find(query).lean();

    sendResponse(
      res,
      categories,
      "All categories fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    console.log({ error });
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
    const { id } = req.params || {};

    if (!id) {
      sendResponse(
        res,
        null,
        "Category id is required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }
    const categoryId = new mongoose.Types.ObjectId(id);

    // ✅ Step 2: Then run aggregation for form and fields
    const categoryWithFormAndFields = await Category.aggregate([
      {
        $match: { _id: categoryId },
      },
      {
        $lookup: {
          from: "forms",
          let: { categoryId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$categoryId", "$$categoryId"] }],
                },
              },
            },
            {
              $lookup: {
                from: "fields",
                localField: "fields",
                foreignField: "_id",
                as: "fields",
              },
            },
          ],
          as: "form",
        },
      },
      {
        $unwind: {
          path: "$form",
          preserveNullAndEmptyArrays: true, // ✅ allow empty form gracefully
        },
      },
    ]);

    sendResponse(
      res,
      categoryWithFormAndFields[0],
      "Category details with form and fields fetched successfully",
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
    const { name, zoneId, status } = req.body;

    if (!name || !zoneId) {
      sendResponse(
        res,
        null,
        "Name and Zone ID are required",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      sendResponse(res, null, "Invalid Zone ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const thumbnail = req.file ? `/uploads/${req.file.filename}` : undefined;

    const category = new Category({
      name,
      zoneId,
      status,
      thumbnail,
    });

    await category.save();

    sendResponse(
      res,
      category,
      "Category created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

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

    const { name, status, zoneId } = req.body;

    if (zoneId && !mongoose.Types.ObjectId.isValid(zoneId)) {
      sendResponse(res, null, "Invalid Zone ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    let thumbnail = existingCategory.thumbnail;
    if (req.file) {
      if (existingCategory.thumbnail) {
        const oldPath = path.join(process.cwd(), existingCategory.thumbnail);
        deleteFile(oldPath);
      }
      thumbnail = `/uploads/${req.file.filename}`;
    }

    existingCategory.name = name || existingCategory.name;
    existingCategory.status = status || existingCategory.status;
    existingCategory.zoneId = zoneId || existingCategory.zoneId;
    existingCategory.thumbnail = thumbnail;

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

    if (category.thumbnail) {
      const oldFilePath = path.join(process.cwd(), category.thumbnail);
      deleteFile(oldFilePath);
    }

    category.thumbnail = `/uploads/${req.file.filename}`;

    await category.save();

    sendResponse(
      res,
      category,
      "Thumbnail updated successfully",
      STATUS_CODES.OK
    );
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

  try {
    const category = await Category.findByIdAndDelete(categoryId);

    if (!category) {
      sendResponse(res, null, "Category not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (category.thumbnail) {
      const filePath = path.join(process.cwd(), category.thumbnail);
      deleteFile(filePath);
    }

    sendResponse(
      res,
      category,
      "Category deleted successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
