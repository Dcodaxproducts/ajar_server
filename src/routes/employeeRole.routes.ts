import express from "express";
import asyncHandler from "express-async-handler";
import * as roleController from "../controllers/employeeRole.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/", authMiddleware, asyncHandler(roleController.createRole));
router.get("/", authMiddleware, asyncHandler(roleController.getAllRoles));
router.get("/:id", authMiddleware, asyncHandler(roleController.getRoleById));
router.patch("/:id", authMiddleware, asyncHandler(roleController.updateRole));
router.delete("/:id", authMiddleware, asyncHandler(roleController.deleteRole));

export default router;
