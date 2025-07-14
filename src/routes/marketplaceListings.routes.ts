import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import { marketplaceListingSchema } from "../schemas/marketplaceListings.Schema";
import { createMarketplaceListing, getAllMarketplaceListings,
  getMarketplaceListingById,
  updateMarketplaceListing,
  deleteMarketplaceListing,} from "../controllers/marketplaceListings.controller";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import upload from "../utils/multer";

const router = express.Router();

router.get("/", getAllMarketplaceListings);
router.get("/:id", getMarketplaceListingById);

router.post(
  "/",
  authMiddleware,
  validateRequest({ body: marketplaceListingSchema }),
  createMarketplaceListing
);


// Utility to wrap async middlewares
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


router.patch(
  "/:id",
  upload.single("thumbnail"),
   asyncHandler(languageTranslationMiddleware(MarketplaceListing)),
  updateMarketplaceListing
);

router.delete("/:id", authMiddleware, deleteMarketplaceListing);

export default router;
