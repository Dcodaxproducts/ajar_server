import { Router } from "express";
import {
  getAllFields,
  getFieldDetails,
  createNewField,
  updateField,
  deleteField,
} from "../controllers/field.controller";
import { validateRequest } from "../middlewares/validateRequest";
import { fieldSchema } from "../schemas/field.schema";
import { authMiddleware } from "../middlewares/auth.middleware";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { Field } from "../models/field.model";

const router = Router();

router.get("/", getAllFields);
router.get("/:id", getFieldDetails);
router.post(
  "/",
  authMiddleware,
  validateRequest({ body: fieldSchema }),
  createNewField
);

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.patch(
  "/:id",
  asyncHandler(languageTranslationMiddleware(Field)),
  updateField
);

router.delete("/:id", authMiddleware, deleteField);

export default router;
