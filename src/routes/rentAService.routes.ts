import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";

import upload from "../utils/multer";

// import {
//   createNewListing,
//   getAllListings,
//   getListingDetails,
// } from "../controllers/listing.controller";
import {
  createRentRequest,
  getAllRentRequests,
} from "../controllers/rentAService.controller";

const router = express.Router();

router.get("/", getAllRentRequests);
router.post(
  "/",
  authMiddleware,
  //   validateRequest({ body: categorySchema }),
  createRentRequest
);
// router.get("/:id", getListingDetails);

export default router;
