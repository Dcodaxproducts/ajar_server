import express from "express";
import { createBusinessSetting, deleteBusinessSettingByPage, getBusinessSettingByPage, updateBusinessSetting } from "../controllers/businessSetting.controller";
import upload from "../utils/multer";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { BusinessSetting } from "../models/businessSetting.model";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post("/", asyncHandler(createBusinessSetting));

router.patch(
  "/:pageName",
   upload.single("thumbnail"),
  asyncHandler(languageTranslationMiddleware(BusinessSetting)),
  asyncHandler(updateBusinessSetting)
);

router.get("/:pageName", asyncHandler(getBusinessSettingByPage)); 
router.delete("/:pageName", asyncHandler(deleteBusinessSettingByPage));

export default router;
