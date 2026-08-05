import express from "express";
import {
  getReminderSettings,
  updateReminderSetting,
} from "../controllers/reminderSetting.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.get("/", useAuth, adminOnly, asyncHandler(getReminderSettings));
router.patch("/:type", useAuth, adminOnly, asyncHandler(updateReminderSetting));

export default router;
