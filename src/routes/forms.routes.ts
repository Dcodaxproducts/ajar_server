import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";

import {
  getAllCategories,
  getCategoryDetails,
} from "../controllers/category.controller";
import { createNewForm, getAllForms, getFormDetails } from "../controllers/forms.controller";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { Form } from "../models/form.model";

const router = express.Router();


// Get all forms
router.get("/", getAllForms);

// Get form by ID
router.get("/:id", getFormDetails);

// Create form
router.post("/", authMiddleware, createNewForm);

// Add/update translations
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


router.patch("/:id", asyncHandler(languageTranslationMiddleware(Form)));

// Delete form
// router.delete("/:id", authMiddleware, deleteForm);


export default router;
