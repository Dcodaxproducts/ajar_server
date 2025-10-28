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

const router = express.Router();

const useAuth = authMiddleware as any;

router.post("/", useAuth, createRefundRequest);
router.get("/", getMyRefundRequests);
router.get("/:id", getRefundRequestById);
router.patch("/:id", useAuth, updateRefundRequest);
router.delete("/:id", useAuth, deleteRefundRequest);

// Admin can update status of requests
router.patch("/:id/status", useAuth, updateRefundStatus);

export default router;
