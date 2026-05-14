import express from "express";
import {
  createDamageReport,
  deleteDamageReport,
  getAllDamageReports,
  getDamageReportById,
  updateDamageReport,
  updateDamageReportStatus
} from "../controllers/damageReport.controller";
import { uploadFiles } from "../utils/multer";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;
const userOnly = allowRoles(["user"]) as unknown as express.RequestHandler;

router.post(
  "/",
  uploadFiles(["attachments"]),
  useAuth,
  userOnly,
  asyncHandler(createDamageReport)
);

// Read all
router.get("/", useAuth, adminOnly, asyncHandler(getAllDamageReports));

// Read by ID
router.get("/:id", useAuth, adminOnly, asyncHandler(getDamageReportById));

// Update
router.patch(
  "/:id",
  uploadFiles(["attachments"]),
  asyncHandler(updateDamageReport)
);

// Delete
router.delete("/:id", asyncHandler(deleteDamageReport));

// PATCH /api/damage-report/:id/status
router.patch("/:id/status", useAuth, adminOnly, asyncHandler(updateDamageReportStatus));

export default router;
