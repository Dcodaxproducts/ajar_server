import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import upload from "../utils/multer";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { Employee } from "../models/employeeManagement.model";
import { createEmployee, deleteEmployee, getAllEmployees, getEmployeeById, updateEmployee } from "../controllers/employeeManagement.controller";
import { employeeAuthMiddleware } from "../middlewares/employeeAuth.middleware";
import { createZone, deleteZone, getAllZones, getZoneDetails, updateZone } from "../controllers/zone.controller";
import { Zone } from "../models/zone.model";
import { validateRequest } from "../middlewares/validateRequest";
import { categorySchema } from "../schemas/category.schema";
import { createNewCategory, deleteCategory, getAllCategories, getCategoryDetails, updateCategory, updateCategoryThumbnail } from "../controllers/category.controller";
import { Category } from "../models/category.model";
import { fieldSchema } from "../schemas/field.schema";
import { createNewField, deleteField, getAllFields, getFieldDetails, updateField } from "../controllers/field.controller";
import { Field } from "../models/field.model";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get("/", getAllEmployees);
router.get("/:id", asyncHandler(getEmployeeById));

router.post(
  "/",
  authMiddleware,
  upload.array("images", 5),
 asyncHandler(createEmployee)
);

router.patch(
  "/:id",
  authMiddleware,
  upload.array("images", 5),
  asyncHandler(languageTranslationMiddleware(Employee)),
 asyncHandler(updateEmployee)
);

router.delete("/:id", authMiddleware, asyncHandler(deleteEmployee));


//zone management routes
// Employee access routes
router.post(
  "/employee",
  employeeAuthMiddleware,
  upload.single("thumbnail"),
  createZone
);

router.patch(
  "/employee/:id",
  employeeAuthMiddleware,
  upload.single("thumbnail"),
  asyncHandler(languageTranslationMiddleware(Zone)),
  updateZone
);

router.get("/", employeeAuthMiddleware, getAllZones);
router.get("/:id", employeeAuthMiddleware, getZoneDetails);
router.delete("/:id", employeeAuthMiddleware, deleteZone);

//category management routes
// Employee access routes
router.post(
  "/category",
  employeeAuthMiddleware,
  upload.single("thumbnail"),
  validateRequest({ body: categorySchema }),
  createNewCategory
);

router.patch(
  "/category/:id",
  upload.single("thumbnail"),
  asyncHandler(languageTranslationMiddleware(Category)),
  updateCategory
);

router.patch(
  "/category/:id/thumbnail",
  employeeAuthMiddleware,
  upload.single("thumbnail"),
  updateCategoryThumbnail
);

router.get("/", getAllCategories);
router.get("/:id", getCategoryDetails);
router.delete("/:id", deleteCategory);

//field management routes
// Employee access routes

router.post(
  "/field",
  employeeAuthMiddleware,
  validateRequest({ body: fieldSchema }),
  createNewField
);

router.patch(
  "/:id",
  asyncHandler(languageTranslationMiddleware(Field)),
  updateField
);
router.get("/", getAllFields);
router.get("/:id", getFieldDetails);
router.delete("/:id", employeeAuthMiddleware, deleteField);

export default router;