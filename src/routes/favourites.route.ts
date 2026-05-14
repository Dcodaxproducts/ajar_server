import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  addFavourite,
  checkIsFavourited,
  getAllFavourites,
  getUserFavourites,
  removeFavourite,
} from "../controllers/toggleFavouriteController";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;
const userOnly = allowRoles(["user"]) as unknown as express.RequestHandler;

// Add to favorites
router.post("/", useAuth, userOnly, asyncHandler(addFavourite));

// Remove from favorites
router.patch("/", useAuth, userOnly, asyncHandler(removeFavourite));

router.get("/", useAuth, userOnly, asyncHandler(getAllFavourites));

// Get user's favorites
router.get(
  "/:userId/favourites",
  useAuth,
  userOnly,
  asyncHandler(getUserFavourites)
);

// Check if item is favorited
router.get(
  "/:userId/is-favourites",
  useAuth,
  userOnly,
  asyncHandler(checkIsFavourited)
);

export default router;
