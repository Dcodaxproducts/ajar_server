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
  getAllMarketplaceListingsforLeaser,
  getMarketplaceListingByIdforLeaser,
  getPopularMarketplaceListings,
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

const useAuth = authMiddleware as any;

router.get("/search", asyncHandler(searchMarketplaceListings));

router.get("/listing", useAuth, asyncHandler(getAllMarketplaceListingsforLeaser));

router.get("/", useAuth, asyncHandler(getAllMarketplaceListings));

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
