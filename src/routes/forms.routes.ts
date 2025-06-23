import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";

import {
  getAllCategories,
  getCategoryDetails,
} from "../controllers/category.controller";
import { createNewForm } from "../controllers/forms.controller";

const router = express.Router();

router.get("/", getAllCategories);
router.post(
  "/",
  authMiddleware,
  //   validateRequest({ body: categorySchema }),
  createNewForm
);
router.get("/:id", getCategoryDetails);
export default router;
