import express from "express";
import {
  createRefundPolicy,
  getAllRefundPolicies,
  updateRefundPolicy,
  deleteRefundPolicy,
} from "../controllers/refundPolicy.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/", authMiddleware, createRefundPolicy);
router.get("/", authMiddleware, getAllRefundPolicies);
// router.patch("/:id", authMiddleware, updateRefundPolicy)
router.patch("/:zone/:subCategory", authMiddleware, updateRefundPolicy);

router.delete("/:id", authMiddleware, deleteRefundPolicy);

export default router;
