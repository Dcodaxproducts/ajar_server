import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import upload, { uploadFiles } from "../utils/multer";
import { categorySchema } from "../schemas/category.schema";
import {
  createNewCategory,
  deleteCategory,
  getAllCategories,
  getCategoryDetails,
  getCategoryNamesAndIds,
  getCategoryWithSubcategories,
  updateCategory,
  updateCategoryThumbnail,
} from "../controllers/category.controller";
import { Category, SubCategory } from "../models/category.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";

const router = express.Router();

router.get("/", getAllCategories);
router.get("/list", getCategoryNamesAndIds);
router.get("/:id", getCategoryDetails);
router.get("/:id/subcategories", getCategoryWithSubcategories);



router.post(
  "/",
  authMiddleware,
   uploadFiles(['thumbnail', 'icon', 'image']),
  validateRequest({ body: categorySchema }),
  createNewCategory
);

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.patch(
  "/:id",
     uploadFiles(['thumbnail', 'icon', 'image']),
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
