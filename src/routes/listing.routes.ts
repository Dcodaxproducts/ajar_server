import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { authMiddleware } from "../middlewares/auth.middleware";

import upload from "../utils/multer";

import {
  createNewListing,
  getAllListings,
  getListingDetails,
} from "../controllers/listing.controller";

const router = express.Router();

router.get("/", getAllListings);
router.post(
  "/",
  authMiddleware,
  //   upload.single("thumbnail"),
  upload.any(),
  //   validateRequest({ body: categorySchema }),
  createNewListing
);
router.get("/:id", getListingDetails);
export default router;
