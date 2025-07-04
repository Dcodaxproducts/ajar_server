import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";
import { marketplaceListingSchema } from "../schemas/marketplaceListings.Schema";
import { createMarketplaceListing, getAllMarketplaceListings,
  getMarketplaceListingById,
  updateMarketplaceListing,
  deleteMarketplaceListing,} from "../controllers/marketplaceListings.controller";

const router = express.Router();

router.get("/", getAllMarketplaceListings);
router.get("/:id", getMarketplaceListingById);

router.post(
  "/",
  authMiddleware,
  validateRequest({ body: marketplaceListingSchema }),
  createMarketplaceListing
);

router.patch(
  "/:id",
  authMiddleware,
  validateRequest({ body: marketplaceListingSchema }),
  updateMarketplaceListing
);

router.delete("/:id", authMiddleware, deleteMarketplaceListing);

export default router;
