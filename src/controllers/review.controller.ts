import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { Review } from "../models/review.model";

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
  const userId = req.user?.id;

  if (!stars || !comment) {
    res.status(400).json({ message: "Stars and comment are required" });
    return;
  }

  const review = await Review.create({ userId, stars, comment });
  res.status(201).json({ success: true, data: review });
});

// Get All Reviews
export const getAllReviews = asyncHandler(async (req: Request, res: Response) => {
  const reviews = await Review.find().populate("userId", "name email");
  res.status(200).json({ success: true, data: reviews });
});
