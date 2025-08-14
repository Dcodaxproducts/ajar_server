import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import { marketplaceListingSchema } from "../schemas/marketplaceListings.Schema";
import {
  createMarketplaceListing,
  getAllMarketplaceListings,
  getMarketplaceListingById,
  updateMarketplaceListing,
  deleteMarketplaceListing,
  searchMarketplaceListings,
} from "../controllers/marketplaceListings.controller";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import upload, { uploadFiles } from "../utils/multer";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get("/search", asyncHandler(searchMarketplaceListings));
router.get("/", authMiddleware, getAllMarketplaceListings);
router.get("/:id", getMarketplaceListingById);

router.post(
  "/",
  uploadFiles(["images"]),
  authMiddleware,
  validateRequest({ body: marketplaceListingSchema }),
  createMarketplaceListing
);

router.patch(
  "/:id",
  uploadFiles(["images"]),
  authMiddleware,
  asyncHandler(languageTranslationMiddleware(MarketplaceListing)),
  updateMarketplaceListing
);

router.delete("/:id", authMiddleware, deleteMarketplaceListing);

export default router;
