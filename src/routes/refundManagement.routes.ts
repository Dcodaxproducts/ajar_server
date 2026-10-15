import express from "express";
import {
  createRefundSettings,
  getAllRefundSettings,
  updateRefundSettings,
  deleteRefundSettings,
  createRefundRequest,
  getMyRefundRequests,
  getRefundRequestById,
  updateRefundStatus,
  getRefundPreview
} from "../controllers/refundManagement.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

const useAuth = authMiddleware as any;
const userOnly = allowRoles(["user"]) as unknown as express.RequestHandler;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

// for admin
router.post("/admin", useAuth, adminOnly, createRefundSettings);
router.get("/admin", useAuth, adminOnly, getAllRefundSettings);
router.patch("/admin/:id", useAuth, adminOnly, updateRefundSettings);
router.delete("/admin/:id", useAuth, adminOnly, deleteRefundSettings);
router.patch("/admin/:id/status", useAuth, adminOnly, updateRefundStatus);

// for user
router.get("/user/preview", useAuth, getRefundPreview);
router.post("/user", useAuth, userOnly, createRefundRequest);
router.get("/user", useAuth, userOnly, getMyRefundRequests);
router.get("/user/:id", useAuth, userOnly, getRefundRequestById);

export default router;
