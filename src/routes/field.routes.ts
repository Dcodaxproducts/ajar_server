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

const router = Router();

router.get("/", getAllFields);
router.get("/:id", getFieldDetails);
router.post(
  "/",
  authMiddleware,
  validateRequest({ body: fieldSchema }),
  createNewField
);
router.patch(
  "/:id",
  authMiddleware,
  // validateRequest({ body: fieldSchema }),
  updateField
);
router.delete("/:id", authMiddleware, deleteField);

export default router;
