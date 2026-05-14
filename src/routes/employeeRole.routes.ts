import express from "express";
import asyncHandler from "express-async-handler";
import * as roleController from "../controllers/employeeRole.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.post("/", useAuth, adminOnly, asyncHandler(roleController.createRole));
router.get("/", useAuth, adminOnly, asyncHandler(roleController.getAllRoles));
router.get("/:id", useAuth, adminOnly, asyncHandler(roleController.getRoleById));
router.patch("/:id", useAuth, adminOnly, asyncHandler(roleController.updateRole));
router.delete("/:id", useAuth, adminOnly, asyncHandler(roleController.deleteRole));

export default router;
