import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Article } from "../models/article.model";
import { paginateQuery } from "../utils/paginate";
import fs from "fs";
import path from "path";


// Helper function to format image paths
function formatPath(filePath: string) {
  return filePath.replace(process.cwd(), "").replace(/\\/g, "/").replace("/public", "");
}

// Create Article
export const createArticle = async (req: AuthRequest, res: Response) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return sendResponse(
        res,
        null,
        "Title and description are required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const images = req.files
      ? (req.files as Express.Multer.File[]).map(f => formatPath(f.path))
      : [];

    const article = await Article.create({ title, description, images });

    sendResponse(res, article, "Article created successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error creating article", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

/// Update Article
export const updateArticle = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    const article = await Article.findById(id);
    if (!article) {
      return sendResponse(res, null, "Not found", STATUS_CODES.NOT_FOUND);
    }

    if (title) article.title = title;
    if (description) article.description = description;

    if (req.files && (req.files as Express.Multer.File[]).length > 0) {
      const newImages = (req.files as Express.Multer.File[]).map(f =>
        formatPath(f.path)
      );
      article.images.push(...newImages);
    }

    await article.save();
    sendResponse(res, article, "Article updated successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error updating article", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Get All Articles
export const getAllArticles = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const query = Article.find().sort({ createdAt: -1 });
    const paginated = await paginateQuery(query, { page, limit });

    sendResponse(
      res,
      {
        articles: paginated.data,
        total: paginated.total,
        page: paginated.page,
        limit: paginated.limit,
      },
      "Retrieved successfully"
    );
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error retrieving articles", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Get Article By ID
export const getArticleById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const article = await Article.findById(id);
    if (!article) {
      return sendResponse(res, null, "Not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, article, "Retrieved successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error retrieving article", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Delete Article
export const deleteArticle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const article = await Article.findById(id);
    if (!article) {
      return sendResponse(res, null, "Not found", STATUS_CODES.NOT_FOUND);
    }

    // Delete images physically
    if (article.images && article.images.length > 0) {
      article.images.forEach(img => {
        const fullPath = path.join(process.cwd(), img);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      });
    }

    await Article.findByIdAndDelete(id);

    sendResponse(res, article, "Deleted successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error deleting article", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};