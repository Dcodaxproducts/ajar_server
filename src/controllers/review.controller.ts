import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { Review } from "../models/review.model";
import { Booking } from "../models/booking.model";

// Define AuthRequest interface if not already defined elsewhere
interface AuthRequest extends Request {
  user?: {
    id: string;
    // add other user properties if needed
  };
}

// Create Review
export const createReview = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { stars, comment } = req.body;
  const bookingId = req.params.bookingId || req.body.bookingId;
  const userId = req.user?.id;

  if (!bookingId) {
    res.status(400).json({ message: "bookingId is required" });
    return;
  }

  // if (!stars || !comment) {
  //   res.status(400).json({ message: "Stars and comment are required" });
  //   return;
  // }
  
  // 1️⃣ Check if booking exists
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }

   // 2️⃣ Ensure the user is the renter of this booking
  // if (booking.renter.toString() !== userId) {
  //   res.status(403).json({ message: "You can only review your own bookings" });
  //   return;
  // }

  // 3️⃣ Check if review already exists for this booking by this user
  const existingReview = await Review.findOne({ bookingId, userId });
  if (existingReview) {
    res.status(400).json({ message: "You have already reviewed this booking" });
    return;
  }


  const review = await Review.create({ userId, bookingId, stars, comment });
  res.status(201).json({ success: true, data: review });
});

// Get All Reviews
// GET ALL REVIEWS
export const getAllReviews = asyncHandler(async (req: Request, res: Response) => {
  const reviews = await Review.find()
    .populate("userId", "name email")
    .populate({
      path: "bookingId",
      select: "status marketplaceListingId dates.priceDetails",
      populate: { path: "marketplaceListingId", select: "title" },
    });

  res.status(200).json({ success: true, data: reviews });
});
