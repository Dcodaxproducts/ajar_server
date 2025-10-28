import express from "express";
import {
  createRefundPolicy,
  getAllRefundPolicies,
  updateRefundPolicy,
  deleteRefundPolicy,
  getRefundPoliciesByZoneAndCategory,
} from "../controllers/refundPolicy.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

const useAuth = authMiddleware as any;

router.post("/", useAuth, createRefundPolicy);
router.get("/", useAuth, getAllRefundPolicies);
// router.patch("/:id", authMiddleware, updateRefundPolicy)
router.patch("/:zone/:subCategory", useAuth, updateRefundPolicy);

router.get(
  "/:zone/:subCategory",
  useAuth,
  getRefundPoliciesByZoneAndCategory
);

router.delete("/:id", useAuth, deleteRefundPolicy);

export default router;
