import { Router } from "express";
import { getAdminAnalytics } from "../controllers/analytics.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getAdminAnalytics);

export default router;
