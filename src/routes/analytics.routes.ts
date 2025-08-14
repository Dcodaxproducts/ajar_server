import { Router } from "express";
import { getAdminAnalytics } from "../controllers/analytics.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getAdminAnalytics);

export default router;

// Last 12 months (default):
// GET /admin/analytics

// Specific window, monthly, filtered to one zone:
// GET /admin/analytics?dateFrom=2024-01-01&dateTo=2025-01-01&granularity=month&zone=<zoneId>

// Pie & trend for one subcategory only:
// GET /admin/analytics?subCategory=<subCatId>
