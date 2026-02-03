import { Request, Response } from "express";
import { User } from "../models/user.model";
import { FavouriteCheck } from "../models/favouriteChecks.model";
import { Booking } from "../models/booking.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import mongoose from "mongoose";

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
      await existingFavourite.deleteOne();
      return res.status(200).json({
        message: "Removed from favourites successfully",
        action: "removed",
      });
    } else {
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
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let matchStage: any = {};

    if (role === "user") {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }
    
    // If role is admin, matchStage remains empty (fetches all)

    const pipeline: any[] = [
      { $match: matchStage },
      
      // Lookup user
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          user: {
            name: "$user.name",
            email: "$user.email",
          },
        },
      },
      
      // Lookup listing
      {
        $lookup: {
          from: "marketplacelistings",
          localField: "listing",
          foreignField: "_id",
          as: "listing",
        },
      },
      { $unwind: { path: "$listing", preserveNullAndEmptyArrays: true } },
      
      // Lookup subCategory
      {
        $lookup: {
          from: "categories",
          localField: "listing.subCategory",
          foreignField: "_id",
          as: "listing.subCategory",
        },
      },
      {
        $unwind: {
          path: "$listing.subCategory",
          preserveNullAndEmptyArrays: true,
        },
      },
      
      // Lookup zone
      {
        $lookup: {
          from: "zones",
          localField: "listing.zone",
          foreignField: "_id",
          as: "listing.zone",
        },
      },
      {
        $unwind: {
          path: "$listing.zone",
          preserveNullAndEmptyArrays: true,
        },
      },
      
      // Lookup booking
      {
        $lookup: {
          from: "bookings",
          localField: "booking",
          foreignField: "_id",
          as: "booking",
        },
      },
      { $unwind: { path: "$booking", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          booking: {
            bookingName: "$booking.bookingName",
            startDate: "$booking.startDate",
            endDate: "$booking.endDate",
            status: "$booking.status",
          },
        },
      },
      
      // Lookup form for userDocuments and leaserDocuments
      {
        $lookup: {
          from: "forms",
          let: {
            subCatId: "$listing.subCategory._id",
            zoneId: "$listing.zone._id",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$subCategory", "$$subCatId"] },
                    { $eq: ["$zone", "$$zoneId"] },
                  ],
                },
              },
            },
            {
              $project: {
                setting: 1,
                userDocuments: 1,
                leaserDocuments: 1,
              },
            },
          ],
          as: "form",
        },
      },
      
      // Add userDocuments and leaserDocuments to listing
      {
        $addFields: {
          "listing.userDocuments": {
            $ifNull: [{ $arrayElemAt: ["$form.userDocuments", 0] }, []],
          },
          "listing.leaserDocuments": {
            $ifNull: [{ $arrayElemAt: ["$form.leaserDocuments", 0] }, []],
          },
        },
      },
      
      // Project only subCategory name and description
      {
        $addFields: {
          "listing.subCategory": {
            name: "$listing.subCategory.name",
            description: "$listing.subCategory.description",
            _id: "$listing.subCategory._id",
          },
          "listing.zone": {
            name: "$listing.zone.name",
            _id: "$listing.zone._id",
          },
        },
      },
      
      // Cleanup - remove form field
      { $project: { form: 0 } },
    ];

    const favourites = await FavouriteCheck.aggregate(pipeline);

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
