import { Router } from "express";
import { getNotifications, getUnreadNotificationCount, markAllNotificationsAsRead } from "../controllers/notification.controller";
import { authMiddleware } from "../middlewares/auth.middleware";


const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get("/", authMiddleware as any, asyncHandler(getNotifications));

router.get("/unread-count", authMiddleware as any, asyncHandler(getUnreadNotificationCount));

router.patch("/mark-all-read", authMiddleware as any, asyncHandler(markAllNotificationsAsRead));

export default router;
