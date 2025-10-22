import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { Review } from "../models/review.model";
import { Booking } from "../models/booking.model";

//AuthRequest interface
interface AuthRequest extends Request {
  user?: {
    id: string;
  };
}

// Create Review
export const createReview = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { stars, comment } = req.body;
    const bookingId = req.params.bookingId || req.body.bookingId;
    const userId = req.user?.id;

    if (!bookingId) {
      res.status(400).json({ message: "bookingId is required" });
      return;
    }

    //Check if booking exists
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404).json({ message: "Booking not found" });
      return;
    }

    //Check if review already exists for this booking by this user
    const existingReview = await Review.findOne({ bookingId, userId });
    if (existingReview) {
      res
        .status(400)
        .json({ message: "You have already reviewed this booking" });
      return;
    }

    const review = await Review.create({ userId, bookingId, stars, comment });
    res.status(201).json({ success: true, data: review });
  }
);

// GET ALL REVIEWS
export const getAllReviews = asyncHandler(
  async (req: Request, res: Response) => {
    const reviews = await Review.find()
      .populate("userId", "name email")
      .populate({
        path: "bookingId",
        select: "status marketplaceListingId dates.priceDetails",
        populate: { path: "marketplaceListingId", select: "title" },
      });

    res.status(200).json({ success: true, data: reviews });
  }
);
