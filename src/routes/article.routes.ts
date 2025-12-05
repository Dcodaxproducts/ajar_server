import express from "express";

import {
  createArticle,
  updateArticle,
  getAllArticles,
  getArticleById,
  deleteArticle,
} from "../controllers/article.controller";

import { authMiddleware } from "../middlewares/auth.middleware";
import upload from "../utils/multer";

const router = express.Router();
const useAuth = authMiddleware as any;

function asyncHandler(fn: any) {
  return (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

// Create Article
router.post(
  "/",
  useAuth,
  upload.array("images", 10), 
  asyncHandler(createArticle)
);

// Update Article
router.patch(
  "/:id",
  useAuth,
  upload.array("images", 10), 
  asyncHandler(updateArticle)
);

// Get all
router.get("/", asyncHandler(getAllArticles));

// Get by ID
router.get("/:id", asyncHandler(getArticleById));

// Delete
router.delete("/:id", useAuth, asyncHandler(deleteArticle));

export default router;
