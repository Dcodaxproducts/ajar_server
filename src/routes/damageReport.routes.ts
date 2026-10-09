import express from "express";
import {
  createDamageReport,
  getAllDamageReports,
  getDamageReportById,
  updateDamageReportStatus,
} from "../controllers/damageReport.controller";
import { uploadDamageEvidence } from "../utils/multer";
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
const authenticatedUser = allowRoles(["user", "admin"]) as unknown as express.RequestHandler;
const userOnly = allowRoles(["user"]) as unknown as express.RequestHandler;

router.post("/", useAuth, userOnly, uploadDamageEvidence, asyncHandler(createDamageReport));
router.get("/", useAuth, authenticatedUser, asyncHandler(getAllDamageReports));
router.get("/:id", useAuth, authenticatedUser, asyncHandler(getDamageReportById));
router.patch("/:id/status", useAuth, adminOnly, asyncHandler(updateDamageReportStatus));

export default router;
