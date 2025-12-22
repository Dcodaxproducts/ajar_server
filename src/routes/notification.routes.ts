import { Router } from "express";
import { getUserNotifications } from "../controllers/notification.controller";
import {authMiddleware }  from "../middlewares/auth.middleware";


const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get("/", authMiddleware as any, asyncHandler(getUserNotifications));

export default router;
