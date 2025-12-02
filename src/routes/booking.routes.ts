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
} from "../controllers/booking.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { Booking } from "../models/booking.model";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { get } from "http";

const router = express.Router();
function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

router.post("/", useAuth, asyncHandler(createBooking));
router.get("/", asyncHandler(getAllBookings));
router.get("/:id", getBookingById);
router.get(
  "/admin/user/:userId",
  useAuth,
  asyncHandler(getBookingsByUserIdForAdmin)
);
router.get("/user/bookings", useAuth, asyncHandler(getBookingsByUser));
router.patch(
  "/:id",
  useAuth,
  asyncHandler(languageTranslationMiddleware(Booking)),
  asyncHandler(updateBooking)
);
router.patch("/:id/status", useAuth, asyncHandler(updateBookingStatus));
router.delete("/:id", useAuth, deleteBooking);
router.post("/:id/submit-pin", useAuth, asyncHandler(submitBookingPin));

export default router;
