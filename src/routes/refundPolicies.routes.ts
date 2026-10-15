import express from "express";
import {
  createRefundPolicy,
  getAllRefundPolicies,
  updateRefundPolicy,
  deleteRefundPolicy,
  getRefundPoliciesByZoneAndCategory,
} from "../controllers/refundPolicy.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.post("/", useAuth, adminOnly, createRefundPolicy);
router.get("/", useAuth, adminOnly, getAllRefundPolicies);
// router.patch("/:id", authMiddleware, updateRefundPolicy)
router.patch("/:zone/:subCategory", useAuth, adminOnly, updateRefundPolicy);

router.get(
  "/:zone/:subCategory",
  useAuth,
  getRefundPoliciesByZoneAndCategory
);

router.delete("/:id", useAuth, adminOnly, deleteRefundPolicy);

export default router;
