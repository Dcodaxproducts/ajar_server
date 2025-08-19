import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  addSubCategoriesToZone,
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

router.get("/", authMiddleware, getAllZones);
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

router.patch("/:id/subcategories", addSubCategoriesToZone);

router.delete("/:id", deleteZone);

import {
  updateSecurityDepositRules,
  updateDamageLiabilityTerms,
  updateRentalDurationLimits,
  getSecurityDepositRules,
  getDamageLiabilityTerms,
  getRentalDurationLimits,
} from "../controllers/rentalPolicies.controller";

// GET each section
router.get(
  "/:zoneId/rental-policies/security-deposit-rules",
  authMiddleware,
  asyncHandler(getSecurityDepositRules)
);

router.get(
  "/:zoneId/rental-policies/damage-liability-terms",
  authMiddleware,
  asyncHandler(getDamageLiabilityTerms)
);

router.get(
  "/:zoneId/rental-policies/rental-duration-limits",
  authMiddleware,
  asyncHandler(getRentalDurationLimits)
);

//Update each section
router.patch(
  "/:zoneId/rental-policies/security-deposit-rules",
  authMiddleware,
  asyncHandler(updateSecurityDepositRules)
);

router.patch(
  "/:zoneId/rental-policies/damage-liability-terms",
  authMiddleware,
  asyncHandler(updateDamageLiabilityTerms)
);

router.patch(
  "/:zoneId/rental-policies/rental-duration-limits",
  authMiddleware,
  asyncHandler(updateRentalDurationLimits)
);

export default router;
