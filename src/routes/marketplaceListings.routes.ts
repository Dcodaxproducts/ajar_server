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
  getBookingsForListing,
  updateListingStatus,
} from "../controllers/marketplaceListings.controller";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import upload, { uploadAny, uploadFiles } from "../utils/multer";
import { optionalAuth } from "../middlewares/optionalAuthMiddleware";
import { validateDocuments } from "../middlewares/validateDocuments.middleware";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get("/search", asyncHandler(searchMarketplaceListings));


router.get("/", authMiddleware, getAllMarketplaceListings);
router.get("/guest", getAllMarketplaceListings);

router.get("/:id", asyncHandler(getMarketplaceListingById));

router.get(
  "/:id/bookings",
  authMiddleware,
  asyncHandler(getBookingsForListing)
);

router.post(
  "/",
  authMiddleware,
  uploadAny, // Middleware to accept any file field
  asyncHandler(createMarketplaceListing)
);


// Admin approves/rejects listing
router.patch("/:listingId/status", authMiddleware, asyncHandler(updateListingStatus));

router.patch(
  "/:id",
  uploadFiles(["images", "rentalImages"]),
  authMiddleware,
  asyncHandler(languageTranslationMiddleware(MarketplaceListing)),
  updateMarketplaceListing
);

router.delete("/:id", authMiddleware, deleteMarketplaceListing);

export default router;
