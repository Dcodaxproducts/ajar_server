// src/controllers/notification.controller.ts
import { Request, Response } from "express";
import { Notification } from "../models/notification.model";

export const getUserNotifications = async (req: any, res: Response) => {
  try {
    const userId = req.user.id; // from auth middleware
    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50); // latest 50 notifications

    return res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
