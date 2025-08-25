import express, { Request, Response, NextFunction } from "express";
import asyncHandler from "express-async-handler";
import upload from "../utils/multer";
import { authMiddleware } from "../middlewares/auth.middleware";
import { employeeAuthMiddleware } from "../middlewares/employeeAuth.middleware";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { validateRequest } from "../middlewares/validateRequest";
import { categorySchema } from "../schemas/category.schema";
import { fieldSchema } from "../schemas/field.schema";

// Import controllers
import * as employeeController from "../controllers/employeeManagement.controller";
import * as zoneController from "../controllers/zone.controller";
import * as categoryController from "../controllers/category.controller";
import * as fieldController from "../controllers/field.controller";

// Import models
import { Employee } from "../models/employeeManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import { Field } from "../models/field.model";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";

const router = express.Router();

// Helper function to properly type the asyncHandler with languageTranslationMiddleware
const wrapTranslationMiddleware = (model: any) => {
  return asyncHandler(async (req, res, next) => {
    await new Promise<void>((resolve, reject) => {
      languageTranslationMiddleware(model)(req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    next();
  });
};

// EMPLOYEE ROUTES (Admin only)
router.get(
  "/",
  authMiddleware,
  asyncHandler(employeeController.getAllEmployees)
);
router.get(
  "/:id",
  authMiddleware,
  asyncHandler(employeeController.getEmployeeById)
);

router.post(
  "/",
  authMiddleware,
  // upload.array("images", 5),
  upload.fields([
    { name: "images", maxCount: 5 },
    { name: "profileImage", maxCount: 1 },
  ]),
  asyncHandler(employeeController.createEmployee)
);

router.patch(
  "/:id",
  authMiddleware,
  upload.fields([
    { name: "images", maxCount: 5 },
    { name: "profileImage", maxCount: 1 },
  ]),
  wrapTranslationMiddleware(Employee),
  asyncHandler(employeeController.updateEmployee)
);

router.delete(
  "/:id",
  authMiddleware,
  asyncHandler(employeeController.deleteEmployee)
);

// ZONE ROUTES (Zone Manager only)
router.post(
  "/zones",
  employeeAuthMiddleware("zone", "create"),
  upload.single("thumbnail"),
  asyncHandler(zoneController.createZone)
);

router.patch(
  "/zones/:id",
  employeeAuthMiddleware("zone", "update"),
  upload.single("thumbnail"),
  wrapTranslationMiddleware(Zone),
  asyncHandler(zoneController.updateZone)
);

router.get("/zones", authMiddleware, asyncHandler(zoneController.getAllZones));

// router.get("/zones", employeeAuthMiddleware("zone", "read"), asyncHandler(zoneController.getAllZones));
router.get(
  "/zones/:id",
  employeeAuthMiddleware("zone", "read"),
  asyncHandler(zoneController.getZoneDetails)
);
router.delete(
  "/zones/:id",
  employeeAuthMiddleware("zone", "delete"),
  asyncHandler(zoneController.deleteZone)
);

// CATEGORY ROUTES (Categories Manager only)
router.post(
  "/categories",
  employeeAuthMiddleware("categories", "create"),
  upload.single("thumbnail"),
  validateRequest({ body: categorySchema }),
  asyncHandler(categoryController.createNewCategory)
);

router.patch(
  "/categories/:id",
  employeeAuthMiddleware("categories", "update"),
  upload.single("thumbnail"),
  wrapTranslationMiddleware(Category),
  asyncHandler(categoryController.updateCategory)
);

router.patch(
  "/categories/:id/thumbnail",
  employeeAuthMiddleware("categories", "update"),
  upload.single("thumbnail"),
  asyncHandler(categoryController.updateCategoryThumbnail)
);

// Public read access to categories
router.get(
  "/categories",
  employeeAuthMiddleware("categories", "read"),
  asyncHandler(categoryController.getAllCategories)
);

// Manager-only category endpoints
router.get(
  "/categories/:id",
  employeeAuthMiddleware("categories", "read"),
  asyncHandler(categoryController.getCategoryDetails)
);
router.delete(
  "/categories/:id",
  employeeAuthMiddleware("categories", "delete"),
  asyncHandler(categoryController.deleteCategory)
);

// FIELD ROUTES (Field Manager only)
router.post(
  "/fields",
  employeeAuthMiddleware("field", "create"),
  validateRequest({ body: fieldSchema }),
  asyncHandler(fieldController.createNewField)
);

router.patch(
  "/fields/:id",
  employeeAuthMiddleware("field", "update"),
  wrapTranslationMiddleware(Field),
  asyncHandler(fieldController.updateField)
);

router.get(
  "/fields",
  employeeAuthMiddleware("field", "read"),
  asyncHandler(fieldController.getAllFields)
);
router.get(
  "/fields/:id",
  employeeAuthMiddleware("field", "read"),
  asyncHandler(fieldController.getFieldDetails)
);
router.delete(
  "/fields/:id",
  employeeAuthMiddleware("field", "delete"),
  asyncHandler(fieldController.deleteField)
);

// CROSS-ROLE ACCESS ROUTES (For employees with multiple staffRoles)
router.get(
  "/my-resources",
  employeeAuthMiddleware("zone", "categories", "field"),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const employee = (req as any).employee;

    const resources: any = {};

    if (employee.staffRoles.includes("zone")) {
      const mockNext = () => {};
      const mockReq = { ...req, query: {} } as Request;
      const mockRes = {
        json: (data: any) => {
          resources.zones = data;
        },
        status: () => mockRes,
      } as unknown as Response;

      await zoneController.getAllZones(mockReq, mockRes, mockNext);
    }

    if (employee.staffRoles.includes("categories")) {
      const mockNext = () => {};
      const mockReq = { ...req, query: {} } as Request;
      const mockRes = {
        json: (data: any) => {
          resources.categories = data;
        },
        status: () => mockRes,
      } as unknown as Response;

      await categoryController.getAllCategories(mockReq, mockRes, mockNext);
    }

    if (employee.staffRoles.includes("field")) {
      const mockNext = () => {};
      const mockReq = { ...req, query: {} } as Request;
      const mockRes = {
        json: (data: any) => {
          resources.fields = data;
        },
        status: () => mockRes,
      } as unknown as Response;

      await fieldController.getAllFields(mockReq, mockRes, mockNext);
    }

    sendResponse(res, resources, "Employee resources fetched", STATUS_CODES.OK);
  })
);

export default router;
