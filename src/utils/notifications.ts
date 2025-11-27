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





// export const sendNotification = async (
//   userId: string,
//   title: string,
//   message: string,
//   data?: Record<string, any>
// ) => {
//   try {
//     // Save notification in DB
//     const notification = await Notification.create({
//       user: userId,
//       title,
//       message,
//       type: (data?.type as any) || (data?.bookingId || data?.listingId ? "booking" : "system"),
//       data: data || {},
//     });

//     // Fetch user to get fcmToken
//     const user = await User.findById(userId).lean();
//     if (user && (user as any).fcmToken) {
//       const token = (user as any).fcmToken as string;

//       // Normalize data: FCM data must be string values
//       const fcmData: Record<string, string> = {};
//       if (data) {
//         for (const k of Object.keys(data)) {
//           const v = data[k];
//           fcmData[k] = typeof v === "string" ? v : JSON.stringify(v);
//         }
//       }

//       try {
//         await firebaseMessaging.send({
//           token,
//           notification: {
//             title,
//             body: message,
//           },
//           data: fcmData,
//         });
//       } catch (err) {
//         console.error("Error sending FCM push:", err);
//       }
//     }

//     return notification;
//   } catch (err) {
//     console.error("sendNotification error:", err);
//     return null;
//   }
// };
