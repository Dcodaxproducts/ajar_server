import express from "express";
import {
  createDamageReport,
  decideDamageReport,
  getAllDamageReports,
  getDamageDisputeEligibility,
  getDamageReportById,
  getMyDamageReportForBooking
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
router.get("/eligibility/:bookingId", useAuth, userOnly, asyncHandler(getDamageDisputeEligibility));
router.get("/", useAuth, adminOnly, asyncHandler(getAllDamageReports));
router.get("/mine/:bookingId", useAuth, userOnly, asyncHandler(getMyDamageReportForBooking));
router.get("/:id", useAuth, adminOnly, asyncHandler(getDamageReportById));
router.post("/:id/decision", useAuth, adminOnly, asyncHandler(decideDamageReport));

export default router;
