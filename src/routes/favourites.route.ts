import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  addFavourite,
  checkIsFavourited,
  getAllFavourites,
  getUserFavourites,
  removeFavourite,
} from "../controllers/toggleFavouriteController";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

// Add to favorites
router.post("/", useAuth, asyncHandler(addFavourite));

// Remove from favorites
router.patch("/", useAuth, asyncHandler(removeFavourite));

router.get("/", useAuth, asyncHandler(getAllFavourites));

// Get user's favorites
router.get(
  "/:userId/favourites",
  useAuth,
  asyncHandler(getUserFavourites)
);

// Check if item is favorited
router.get(
  "/:userId/is-favourites",
  useAuth,
  asyncHandler(checkIsFavourited)
);

export default router;
