import { Router } from "express";
import {
  markMessageDelivered,
  markMessagesSeen,
  sendMessage,
} from "../controllers/message.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

router.post("/", useAuth, asyncHandler(sendMessage));

router.patch(
  "/:messageId/delivered",
  useAuth,
  asyncHandler(markMessageDelivered)
);

router.patch("/:chatId/seen", useAuth, asyncHandler(markMessagesSeen));

export default router;
