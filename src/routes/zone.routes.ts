import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  createZone,
  deleteZone,
  getAllZones,
  getZoneDetails,
  updateZone,
  updateZoneThumbnail,
} from "../controllers/zone.controller";
import { zoneSchema } from "../schemas/zone.schema";
import upload from "../utils/multer";

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
router.patch(
  "/:id",
  authMiddleware,
  upload.single("thumbnail"),
  validateRequest({ body: zoneSchema }),
  updateZone
);
router.patch(
  "/:id/thumbnail",
  authMiddleware,
  upload.single("thumbnail"),
  updateZoneThumbnail
);

router.delete("/:id", deleteZone);
export default router;
