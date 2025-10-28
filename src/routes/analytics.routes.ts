import { Router } from "express";
import { getAdminAnalytics } from "../controllers/analytics.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

const useAuth = authMiddleware as any;

router.get("/", useAuth, getAdminAnalytics);

export default router;
