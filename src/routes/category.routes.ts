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

router.patch(
  "/:id",
  authMiddleware,
  upload.single("thumbnail"),
  // validateRequest({ body: categorySchema }),
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
