import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  createMarketplaceListing,
  getAllMarketplaceListings,
  getMarketplaceListingById,
  updateMarketplaceListing,
  deleteMarketplaceListing,
  searchMarketplaceListings,
  getBookingsForListing,
  updateListingStatus,
  getAllMarketplaceListingsforLeaser,
  getMarketplaceListingByIdforLeaser,
  getPopularMarketplaceListings,
} from "../controllers/marketplaceListings.controller";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { uploadAny, uploadFiles } from "../utils/multer";
import { optionalAuth } from "../middlewares/optionalAuthMiddleware";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

router.get("/search", asyncHandler(searchMarketplaceListings));

router.get("/listing", useAuth, asyncHandler(getAllMarketplaceListingsforLeaser));

router.get("/", optionalAuth, asyncHandler(getAllMarketplaceListings));

router.get("/guest", asyncHandler(getAllMarketplaceListings));

router.get("/listing/:id", asyncHandler(getMarketplaceListingByIdforLeaser));
router.get("/popular", getPopularMarketplaceListings);

router.get("/:id", asyncHandler(getMarketplaceListingById));

router.get(
  "/:id/bookings",
  useAuth,
  asyncHandler(getBookingsForListing)
);

router.post(
  "/",
  useAuth,
  uploadAny,
  asyncHandler(createMarketplaceListing)
);

// Admin approves/rejects listing
router.patch(
  "/:listingId/status",
  useAuth,
  asyncHandler(updateListingStatus)
);

router.patch(
  "/:id",
  uploadFiles(["images", "rentalImages"]),
  useAuth,
  asyncHandler(languageTranslationMiddleware(MarketplaceListing)),
  asyncHandler(updateMarketplaceListing)
);

router.delete("/:id", useAuth, asyncHandler(deleteMarketplaceListing));

export default router;
