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

// for admin
router.post("/admin", authMiddleware, createRefundSettings);
router.get("/admin", authMiddleware, getAllRefundSettings);
router.patch("/admin/:id", authMiddleware, updateRefundSettings);
router.delete("/admin/:id", authMiddleware, deleteRefundSettings);
router.patch("/admin/:id/status", authMiddleware, updateRefundStatus);


// for user
router.post("/user", authMiddleware, createRefundRequest);
router.get("/user", authMiddleware, getMyRefundRequests);
router.patch("/user/:id", authMiddleware, updateRefundRequest);
router.delete("/user/:id", authMiddleware, deleteRefundRequest);

export default router;
