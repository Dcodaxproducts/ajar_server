import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";


import { createNewForm, getAllForms, getFormDetails,getFormByZoneAndSubCategory,deleteForm } from "../controllers/forms.controller";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { Form } from "../models/form.model";

const router = express.Router();


// Get all forms
router.get("/", getAllForms);

// routes/form.routes.ts
router.get("/form", getFormByZoneAndSubCategory);

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
router.delete("/:id", authMiddleware, deleteForm);


export default router;
