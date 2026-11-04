import express from "express";
import {
  createDamageReport,
  decideDamageReport,
  getAllDamageReports,
  getDamageDisputeEligibility,
  getDamageReportById,
  getMyDamageReportForBooking,
  getSecurityDepositStatus,
  retryDamageSettlement
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
  useAuth,
  userOnly,
  uploadFiles(["attachments"]),
  asyncHandler(createDamageReport)
);

router.get(
  "/eligibility/:bookingId",
  useAuth,
  userOnly,
  asyncHandler(getDamageDisputeEligibility)
);

// Read all
router.get("/", useAuth, adminOnly, asyncHandler(getAllDamageReports));

// Participants can only read status for their own booking.
router.get("/mine/:bookingId", useAuth, userOnly, asyncHandler(getMyDamageReportForBooking));
router.get("/deposit/:bookingId", useAuth, asyncHandler(getSecurityDepositStatus));
router.post("/:id/settlement/retry", useAuth, adminOnly, asyncHandler(retryDamageSettlement));

// Read by ID
router.get("/:id", useAuth, adminOnly, asyncHandler(getDamageReportById));

// Immutable admin settlement decision. Story 3 owns payment execution.
router.post("/:id/decision", useAuth, adminOnly, asyncHandler(decideDamageReport));

export default router;
