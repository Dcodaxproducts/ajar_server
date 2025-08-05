import { Request, Response } from "express";
import { User } from "../models/user.model";
import { FavouriteCheck } from "../models/favouriteChecks.model";
import { Booking } from "../models/booking.model";
import { AuthRequest } from "../middlewares/auth.middleware";

// Add to favorites
export const addFavourite = async (req: AuthRequest, res: Response) => {
  try {
    // Get user ID from the authenticated request
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { listingId, bookingId } = req.body;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Rest of the function remains the same...
    const existingFavorite = await FavouriteCheck.findOne({
      user: userId,
      $or: [{ listing: listingId }, { booking: bookingId }]
    });

    if (existingFavorite) {
      return res.status(400).json({ message: "Already added to favorites" });
    }

    const newFavorite = new FavouriteCheck({
      user: userId,
      ...(listingId ? { listing: listingId } : {}),
      ...(bookingId ? { booking: bookingId } : {})
    });

    await newFavorite.save();

    return res.status(201).json({
      message: "Added to favorites successfully",
      favorite: newFavorite
    });
  } catch (error) {
    console.error("Error adding favorite:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Remove from favorites
export const removeFavourite = async (req: Request, res: Response) => {
  try {
    const { userId, favoriteId } = req.params;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find and delete favorite
    const favorite = await FavouriteCheck.findOneAndDelete({
      _id: favoriteId,
      user: userId
    });

    if (!favorite) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    return res.status(200).json({
      message: "Removed from favorites successfully"
    });
  } catch (error) {
    console.error("Error removing favorite:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get user's favorites
export const getUserFavourites = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { type } = req.query;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Build query
    const query: any = { user: userId };
    if (type === 'listing') {
      query.listing = { $exists: true };
    } else if (type === 'booking') {
      query.booking = { $exists: true };
    }

    const favorites = await FavouriteCheck.find(query)
      .populate('listing')
      .populate('booking')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      favorites
    });
  } catch (error) {
    console.error("Error getting favorites:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Check if item is favorited
export const checkIsFavourited = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { listingId, bookingId } = req.query;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!listingId && !bookingId) {
      return res.status(400).json({ message: "Must provide listingId or bookingId" });
    }

    const query: any = { user: userId };
    if (listingId) {
      query.listing = listingId;
    } else {
      query.booking = bookingId;
    }

    const favorite = await FavouriteCheck.findOne(query);

    return res.status(200).json({
      isFavorited: !!favorite
    });
  } catch (error) {
    console.error("Error checking favorite:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};