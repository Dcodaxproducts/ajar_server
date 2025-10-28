import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";

import {
  createNewForm,
  getAllForms,
  getFormDetails,
  getFormByZoneAndSubCategory,
  deleteForm,
  updateForm,
} from "../controllers/forms.controller";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { Form } from "../models/form.model";
import upload from "../utils/multer";

const router = express.Router();

const useAuth = authMiddleware as any;

router.get("/", getAllForms);

router.get("/form", getFormByZoneAndSubCategory);

router.get("/:id", getFormDetails);

router.post("/", upload.single("thumbnail"), useAuth, createNewForm);

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.patch(
  "/:id",
  upload.single("thumbnail"),
  asyncHandler(languageTranslationMiddleware(Form)),
  asyncHandler(updateForm)
);

router.delete("/:id", useAuth, deleteForm);

export default router;
