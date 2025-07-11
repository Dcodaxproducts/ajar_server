import express from "express";
import { createDamageReport } from "../controllers/damageReport.controller";
import upload from "../utils/multer";


const router = express.Router();
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post("/", upload.single("image"), asyncHandler(createDamageReport));

export default router;
