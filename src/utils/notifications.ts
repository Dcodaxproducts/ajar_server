import { Notification } from "../models/notification.model";
import { User } from "../models/user.model";
import { firebaseMessaging } from "../config/firebase";

// Normalise notification type from the data payload
const resolveNotifType = (data: Record<string, any>) =>
  data?.type && ["listing", "booking", "admin", "system"].includes(data.type)
    ? data.type
    : data.bookingId
    ? "booking"
    : "system";

// Only saves the notification in DB. Meant to run exactly once per notification —
// callers that retry must guard against calling this twice.
export const createNotification = async (
  userId: string,
  title: string,
  message: string,
  data: Record<string, any> = {}
) => {
  return await Notification.create({
    user: userId,
    title,
    message,
    type: resolveNotifType(data),
    data,
  });
};

// Only sends the FCM push. Deliberately does NOT catch — the caller decides
// whether the failure is worth retrying.
export const sendPushToUser = async (
  userId: string,
  title: string,
  message: string,
  data: Record<string, any> = {}
) => {
  const user = await User.findById(userId).lean();
  if (!user?.fcmToken) return { skipped: true };

  const fcmData: Record<string, string> = {};
  Object.keys(data).forEach((key) => {
    const val = data[key];
    fcmData[key] = typeof val === "string" ? val : JSON.stringify(val);
  });

  await firebaseMessaging.send({
    token: user.fcmToken,
    notification: { title, body: message },
    data: fcmData,
  });

  return { skipped: false };
};

// Drop a token FCM has told us is permanently dead
export const clearFcmToken = async (userId: string) => {
  await User.findByIdAndUpdate(userId, { $unset: { fcmToken: 1 } });
};
