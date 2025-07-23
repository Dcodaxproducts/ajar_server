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
} from "../controllers/refundManagement.controller";
import { authMiddleware } from "../middlewares/auth.middleware"; 

const router = express.Router();

// for admin
router.post("/admin", authMiddleware, createRefundSettings);
router.get("/admin", authMiddleware, getAllRefundSettings);
router.put("/admin/:id", authMiddleware, updateRefundSettings);
router.delete("/admin/:id", authMiddleware, deleteRefundSettings);

// for user
router.post("/user", authMiddleware, createRefundRequest);
router.get("/user", authMiddleware, getMyRefundRequests);
router.put("/user/:id", authMiddleware, updateRefundRequest);
router.delete("/user/:id", authMiddleware, deleteRefundRequest);

export default router;
