import { Router } from "express";
import { sendMessage } from "../controllers/message.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post("/", authMiddleware, asyncHandler(sendMessage));

export default router;
