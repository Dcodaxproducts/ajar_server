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

// Add to favorites
router.post("/", authMiddleware, asyncHandler(addFavourite));

// Remove from favorites
router.patch("/", authMiddleware, asyncHandler(removeFavourite));

router.get("/", authMiddleware, asyncHandler(getAllFavourites));

// Get user's favorites
router.get(
  "/:userId/favorites",
  authMiddleware,
  asyncHandler(getUserFavourites)
);

// Check if item is favorited
router.get(
  "/:userId/is-favorited",
  authMiddleware,
  asyncHandler(checkIsFavourited)
);

export default router;
