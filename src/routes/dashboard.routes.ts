import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { getDashboardStats } from "../controllers/user.controller";

const router = express.Router();
router.get("/stats", authMiddleware, getDashboardStats);

export default router;
