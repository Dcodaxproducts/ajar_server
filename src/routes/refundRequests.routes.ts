import express from "express";
import {
  createRefundRequest,
  getMyRefundRequests,
  updateRefundRequest,
  deleteRefundRequest,
  updateRefundStatus,
  getRefundRequestById,
} from "../controllers/refundRequest.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
// import { getRefundRequestById } from "../controllers/refundManagement.controller";

const router = express.Router();

router.post("/", authMiddleware, createRefundRequest);
router.get("/", getMyRefundRequests);
router.get("/:id", getRefundRequestById);
router.patch("/:id", authMiddleware, updateRefundRequest);
router.delete("/:id", authMiddleware, deleteRefundRequest);

// Admin can update status of requests
router.patch("/:id/status", authMiddleware, updateRefundStatus);

export default router;
