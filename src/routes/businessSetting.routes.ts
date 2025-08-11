import express from "express";
import {
  createBusinessSetting,
  deleteBusinessSettingByPage,
  getBusinessSettingByPage,
  updateOrCreateBusinessSetting,
} from "../controllers/businessSetting.controller";
import upload, { uploadFiles } from "../utils/multer";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { BusinessSetting } from "../models/businessSetting.model";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post(
  "/",
  uploadFiles(["thumbnail", "icon"]),
  asyncHandler(languageTranslationMiddleware(BusinessSetting)),
  asyncHandler(createBusinessSetting)
);

router.patch(
  "/:pageName",
  uploadFiles(["thumbnail", "icon"]),
  asyncHandler(languageTranslationMiddleware(BusinessSetting)),
  asyncHandler(updateOrCreateBusinessSetting)
);

router.get("/:pageName", asyncHandler(getBusinessSettingByPage));
router.delete("/:pageName", asyncHandler(deleteBusinessSettingByPage));

export default router;
