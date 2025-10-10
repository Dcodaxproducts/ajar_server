import { Request, Response } from "express";
import { User } from "../models/user.model";
import { FavouriteCheck } from "../models/favouriteChecks.model";
import { Booking } from "../models/booking.model";
import { AuthRequest } from "../middlewares/auth.middleware";

// Add to favorites
export const addFavourite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { listingId, bookingId } = req.body;

    // Ensure at least one ID is provided
    if (!listingId && !bookingId) {
      return res
        .status(400)
        .json({ message: "Either listingId or bookingId is required" });
    }

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if favourite already exists
    const existingFavorite = await FavouriteCheck.findOne({
      user: userId,
      ...(listingId
        ? { listing: listingId }
        : bookingId
        ? { booking: bookingId }
        : {}),
    });

    if (existingFavorite) {
      return res.status(400).json({ message: "Already added to favourites" });
    }

    // Create new favourite
    const newFavorite = new FavouriteCheck({
      user: userId,
      ...(listingId ? { listing: listingId } : {}),
      ...(bookingId ? { booking: bookingId } : {}),
    });

    await newFavorite.save();

    return res.status(201).json({
      message: "Added to favourites successfully",
      favourite: newFavorite,
    });
  } catch (error) {
    console.error("Error adding favourite:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH - Unfavourite listing or booking
export const removeFavourite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { listingId, bookingId } = req.body;

    // Ensure at least one ID is provided
    if (!listingId && !bookingId) {
      return res
        .status(400)
        .json({ message: "Either listingId or bookingId is required" });
    }

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if favourite already exists
    const existingFavourite = await FavouriteCheck.findOne({
      user: userId,
      ...(listingId
        ? { listing: listingId }
        : bookingId
        ? { booking: bookingId }
        : {}),
    });

    if (existingFavourite) {
      // Remove it
      await existingFavourite.deleteOne();
      return res.status(200).json({
        message: "Removed from favourites successfully",
        action: "removed",
      });
    } else {
      // Add it
      const newFavourite = new FavouriteCheck({
        user: userId,
        ...(listingId ? { listing: listingId } : { booking: bookingId }),
      });

      await newFavourite.save();

      return res.status(201).json({
        message: "Added to favourites successfully",
        action: "added",
        favourite: newFavourite,
      });
    }
  } catch (error) {
    console.error("Error toggling favourite:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET - Get all favourites for logged-in user
export const getAllFavourites = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role; // assuming role is added in the token payload

    if (!userId || !role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let query: any = {};

    if (role === "user") {
      query.user = userId; // show only logged-in user's favourites
    }
    // If role is admin, query remains empty (fetches all)

    const favourites = await FavouriteCheck.find(query)
      .populate("user", "name email") // only admin will see this populated user info
      .populate({
        path: "listing",
        select: "title price location images name description subCategory rentalImages",
        populate: {
          path: "subCategory",
          select: "name description", // you can add translations if needed
        },
      })
      .populate("booking", "bookingName startDate endDate status")
      .lean();

    return res.status(200).json({
      message: "Favourites retrieved successfully",
      count: favourites.length,
      favourites,
    });
  } catch (error) {
    console.error("Error fetching favourites:", error);
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
    if (type === "listing") {
      query.listing = { $exists: true };
    } else if (type === "booking") {
      query.booking = { $exists: true };
    }

    const favorites = await FavouriteCheck.find(query)
      .populate("listing")
      .populate("booking")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      favorites,
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
      return res
        .status(400)
        .json({ message: "Must provide listingId or bookingId" });
    }

    const query: any = { user: userId };
    if (listingId) {
      query.listing = listingId;
    } else {
      query.booking = bookingId;
    }

    const favorite = await FavouriteCheck.findOne(query);

    return res.status(200).json({
      isFavorited: !!favorite,
    });
  } catch (error) {
    console.error("Error checking favorite:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
