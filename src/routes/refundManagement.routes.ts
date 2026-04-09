import express from "express";
import {
  createRefundSettings,
  getAllRefundSettings,
  updateRefundSettings,
  deleteRefundSettings,
  createRefundRequest,
  getMyRefundRequests,
  updateRefundRequest,
  deleteRefundRequest,
  updateRefundStatus,
  getRefundPreview
} from "../controllers/refundManagement.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

const useAuth = authMiddleware as any;
const userOnly = allowRoles(["user"]) as unknown as express.RequestHandler;

// for admin
router.post("/admin", useAuth, createRefundSettings);
router.get("/admin", useAuth, getAllRefundSettings);
router.patch("/admin/:id", useAuth, updateRefundSettings);
router.delete("/admin/:id", useAuth, deleteRefundSettings);
router.patch("/admin/:id/status", useAuth, updateRefundStatus);
router.patch("/admin/:id/status", useAuth, updateRefundStatus);

// for user
router.get("/user/preview", useAuth, getRefundPreview);
router.post("/user", useAuth, userOnly, createRefundRequest);
router.get("/user", useAuth, userOnly, getMyRefundRequests);
router.patch("/user/:id", useAuth, userOnly, updateRefundRequest);
router.delete("/user/:id", useAuth, userOnly, deleteRefundRequest);

export default router;
