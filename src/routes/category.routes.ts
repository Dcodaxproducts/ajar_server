import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import upload from "../utils/multer";
import { categorySchema } from "../schemas/category.schema";
import {
  createNewCategory,
  deleteCategory,
  getAllCategories,
  getCategoryDetails,
  updateCategory,
  updateCategoryThumbnail,
} from "../controllers/category.controller";
import { Category, SubCategory } from "../models/category.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";

const router = express.Router();

router.get("/", getAllCategories);
router.get("/:id", getCategoryDetails);

router.post(
  "/",
  authMiddleware,
  upload.single("thumbnail"),
  validateRequest({ body: categorySchema }),
  createNewCategory
);


// Utility to wrap async middlewares
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


// PATCH: Translate specific fields to a locale
router.patch(
  "/:id",
   upload.single("thumbnail"),
  asyncHandler(languageTranslationMiddleware(Category)),
  updateCategory
);



router.patch(
  "/:id/thumbnail",
  authMiddleware,
  upload.single("thumbnail"),
  updateCategoryThumbnail
);

router.delete("/:id", deleteCategory);

export default router;
