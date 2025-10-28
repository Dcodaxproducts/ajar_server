import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { getDashboardStats } from "../controllers/user.controller";

const router = express.Router();
router.get("/stats", authMiddleware as any, getDashboardStats);

export default router;
