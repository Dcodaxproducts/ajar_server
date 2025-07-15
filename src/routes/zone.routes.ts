import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  createZone,
  deleteZone,
  getAllZones,
  getZoneDetails,
  updateZone,
} from "../controllers/zone.controller";
import { zoneSchema } from "../schemas/zone.schema";
import upload from "../utils/multer";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { Zone } from "../models/zone.model";

const router = express.Router();

router.get("/", getAllZones);
router.get("/:id", getZoneDetails);
router.post(
  "/",
  authMiddleware,
  upload.single("thumbnail"),
  validateRequest({ body: zoneSchema }),
  createZone
);

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


router.patch(
  "/:id",
  upload.single("thumbnail"),
  asyncHandler(languageTranslationMiddleware(Zone)),
  updateZone
);


router.delete("/:id", deleteZone);
export default router;
