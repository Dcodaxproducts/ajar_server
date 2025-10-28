import express from "express";
import asyncHandler from "express-async-handler";
import * as roleController from "../controllers/employeeRole.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

const useAuth = authMiddleware as any;

router.post("/", useAuth, asyncHandler(roleController.createRole));
router.get("/", useAuth, asyncHandler(roleController.getAllRoles));
router.get("/:id", useAuth, asyncHandler(roleController.getRoleById));
router.patch("/:id", useAuth, asyncHandler(roleController.updateRole));
router.delete("/:id", useAuth, asyncHandler(roleController.deleteRole));

export default router;
