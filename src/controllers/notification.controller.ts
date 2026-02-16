import { Response } from "express";
import { Notification } from "../models/notification.model";
import { paginateQuery } from "../utils/paginate";
import { MarketplaceListing } from "../models/marketplaceListings.model";

export const getNotifications = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const filter = { user: userId };

    const query = Notification.find(filter)
      .sort({ createdAt: -1 });

    const paginated = await paginateQuery(query, { page, limit });

    // Collect listingIds
    const listingIds = paginated.data
      .filter((n: any) => n.type === "listing" && n.data?.listingId)
      .map((n: any) => n.data.listingId);

    // Fetch listings in ONE query
    const listings = await MarketplaceListing.find({
      _id: { $in: listingIds },
    }).select("subCategory");

    // Create lookup map
    const listingMap = new Map();
    listings.forEach((listing) => {
      listingMap.set(listing._id.toString(), listing.subCategory);
    });

    // Attach subCategory
    const transformedData = paginated.data.map((notification: any) => {
      if (
        notification.type === "listing" &&
        notification.data?.listingId
      ) {
        const subCategory = listingMap.get(
          notification.data.listingId.toString()
        );

        return {
          ...notification.toObject(),
          data: {
            ...notification.data,
            subCategory: subCategory || null,
          },
        };
      }

      return notification;
    });

    return res.status(200).json({
      success: true,
      data: transformedData,
      total: paginated.total,
      page: paginated.page,
      limit: paginated.limit,
    });

  } catch (err) {
    console.error("Error fetching notifications:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getUnreadNotificationCount = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    const count = await Notification.countDocuments({
      user: userId,
      isRead: false
    });

    return res.status(200).json({
      success: true,
      data: { count }
    });
  } catch (err) {
    console.error("Error fetching notification count:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const markAllNotificationsAsRead = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    const result = await Notification.updateMany(
      { user: userId, isRead: false },
      { $set: { isRead: true } }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { modifiedCount: result.modifiedCount }
    });
  } catch (err) {
    console.error("Error updating notifications:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};