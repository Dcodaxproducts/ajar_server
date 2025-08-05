import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { addFavourite, checkIsFavourited, getUserFavourites, removeFavourite } from "../controllers/toggleFavouriteController";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Add to favorites
router.post("/favorites", authMiddleware, asyncHandler(addFavourite));

// Remove from favorites
router.delete("/:userId/favorites/:favoriteId", authMiddleware, asyncHandler(removeFavourite));

// Get user's favorites
router.get("/:userId/favorites", authMiddleware, asyncHandler(getUserFavourites));

// Check if item is favorited
router.get("/:userId/is-favorited", authMiddleware, asyncHandler(checkIsFavourited));

export default router;