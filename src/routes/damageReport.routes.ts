import express from "express";
import {
  createDamageReport,
  deleteDamageReport,
  getAllDamageReports,
  getDamageReportById,
  updateDamageReport,
  updateDamageReportStatus,
} from "../controllers/damageReport.controller";
import upload from "../utils/multer";
import { uploadFile, uploadFiles } from "../utils/multer";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post(
  "/",
  uploadFiles(["attachments"]),
  authMiddleware,
  asyncHandler(createDamageReport)
);

// Read all
router.get("/", authMiddleware, asyncHandler(getAllDamageReports));

// Read by ID
router.get("/:id", asyncHandler(getDamageReportById));

// Update
router.patch(
  "/:id",
  uploadFiles(["attachments"]),
  asyncHandler(updateDamageReport)
);

// Delete
router.delete("/:id", asyncHandler(deleteDamageReport));

// PATCH /api/damage-report/:id/status
router.patch("/:id/status", authMiddleware, asyncHandler(updateDamageReportStatus));

export default router;
