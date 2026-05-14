import express from "express";
import { Router } from "express";
import { getAdminAnalytics } from "../controllers/analytics.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = Router();

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.get("/", useAuth, adminOnly, getAdminAnalytics);

export default router;
