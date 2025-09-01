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

router.post("/", authMiddleware, asyncHandler(sendMessage));

router.patch(
  "/:messageId/delivered",
  authMiddleware,
  asyncHandler(markMessageDelivered)
);

router.patch("/:chatId/seen", authMiddleware, asyncHandler(markMessagesSeen));

export default router;
