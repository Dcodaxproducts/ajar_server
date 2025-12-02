import { Notification } from "../models/notification.model";
import { User } from "../models/user.model";
import { firebaseMessaging } from "../config/firebase";

export const sendNotification = async (
  userId: string,
  title: string,
  message: string,
  data: Record<string, any> = {}
) => {
  try {
    // Normalise type
    const notifType =
      data?.type && ["listing", "booking", "admin", "system"].includes(data.type)
        ? data.type
        : data.bookingId
        ? "booking"
        : "system";

    // Save in DB
    const notification = await Notification.create({
      user: userId,
      title,
      message,
      type: notifType,
      data,
    });

    // Find user token
    const user = await User.findById(userId).lean();
    if (!user?.fcmToken) return notification;

    // Stringify FCM data
    const fcmData: Record<string, string> = {};
    Object.keys(data).forEach((key) => {
      const val = data[key];
      fcmData[key] = typeof val === "string" ? val : JSON.stringify(val);
    });

    // Send push
    await firebaseMessaging.send({
      token: user.fcmToken,
      notification: { title, body: message },
      data: fcmData,
    });

    return notification;
  } catch (err) {
    console.error("sendNotification ERROR:", err);
    return null;
  }
};

