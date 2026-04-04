import express from "express";
import {
  getAllBookings,
  getBookingById,
  deleteBooking,
  updateBooking,
  createBooking,
  getBookingsByUser,
  getBookingsByUserIdForAdmin,
  updateBookingStatus,
  submitBookingPin,
  getRenterBookingById,
  getSeasonalBookingsGraph,
} from "../controllers/booking.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { Booking } from "../models/booking.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;
const userOnly = allowRoles(["user"]) as unknown as express.RequestHandler;

router.post("/", useAuth, asyncHandler(createBooking));
router.get("/", useAuth, adminOnly, asyncHandler(getAllBookings));
router.get("/:id", useAuth, asyncHandler(getBookingById));
router.get(
  "/admin/user/:userId",
  useAuth,
  adminOnly,
  asyncHandler(getBookingsByUserIdForAdmin)
);
router.get("/user/bookings", useAuth, userOnly, asyncHandler(getBookingsByUser));
router.get("/user/booking/:id", useAuth, userOnly, asyncHandler(getRenterBookingById));

router.patch(
  "/:id",
  useAuth,
  asyncHandler(languageTranslationMiddleware(Booking)),
  asyncHandler(updateBooking)
);
router.patch("/:id/status", useAuth, userOnly, asyncHandler(updateBookingStatus));
router.delete("/:id", useAuth, deleteBooking);
router.post("/:id/submit-pin", useAuth, userOnly, asyncHandler(submitBookingPin));

router.get("/graph/seasonal", useAuth, adminOnly, asyncHandler(getSeasonalBookingsGraph));

export default router;
