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
} from "../controllers/refundManagement.controller";
import { authMiddleware } from "../middlewares/auth.middleware"; 

const router = express.Router();

const useAuth = authMiddleware as any;

// for admin
router.post("/admin", useAuth, createRefundSettings);
router.get("/admin", useAuth, getAllRefundSettings);
router.patch("/admin/:id", useAuth, updateRefundSettings);
router.delete("/admin/:id", useAuth, deleteRefundSettings);
router.patch("/admin/:id/status", useAuth, updateRefundStatus);
router.patch("/admin/:id/status", useAuth, updateRefundStatus);

// for user
router.post("/user", useAuth, createRefundRequest);
router.get("/user", useAuth, getMyRefundRequests);
router.patch("/user/:id", useAuth, updateRefundRequest);
router.delete("/user/:id", useAuth, deleteRefundRequest);

export default router;
