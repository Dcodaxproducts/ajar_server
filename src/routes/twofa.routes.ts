import express from "express";
import {
  enable2FA_Start,
  disable2FA,
  enable2FA_Flag,
  verify2FA,
} from "../controllers/twofa.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();


function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
const useAuth = authMiddleware as any;


router.post("/enable", useAuth, asyncHandler(enable2FA_Flag));
router.post("/start", useAuth, asyncHandler(enable2FA_Start));
router.post("/verify", useAuth, asyncHandler(verify2FA));
router.post("/disable", useAuth, asyncHandler(disable2FA));

export default router;
