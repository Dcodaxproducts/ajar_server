import { Server, Socket } from "socket.io";
import jwt, { JwtPayload } from "jsonwebtoken";
import { config } from "../config/env";
import { Message } from "../models/message.model";

const JWT_SECRET: string = config.JWT_SECRET || "default_secret";

// Users map (online tracking)
const users: Record<string, string> = {};

// Helper function
export const getReceiverSocketId = (receiverId: string): string | undefined => {
  return users[receiverId];
};

// // ✅ Setup function
// export const setupChatSocket = (io: Server) => {
//   // Auth middleware
//   io.use((socket: AuthenticatedSocket, next) => {
//     const token = socket.handshake.auth?.token;
//     if (!token) return next(new Error("Unauthorized: No token"));

//     try {
//       const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & {
//         id: string;
//       };
//       socket.data.user = { id: decoded.id };
//       next();
//     } catch {
//       next(new Error("Unauthorized: Invalid token"));
//     }
//   });

//   // Events
//   io.on("connection", (socket: AuthenticatedSocket) => {
//     const userId = socket.data.user?.id;
//     console.log("✅ User connected:", userId, socket.id);

//     if (userId) {
//       users[userId] = socket.id;
//       io.emit("getOnlineUsers", Object.keys(users));
//     }

//     // Send message
//     socket.on(
//       "sendMessage",
//       async (data: {
//         conversationId: string;
//         text: string;
//         receiver: string;
//       }) => {
//         const { conversationId, text, receiver } = data;

//         const message = await Message.create({
//           conversationId,
//           sender: userId,
//           receiver,
//           text,
//         });

//         const receiverSocketId = getReceiverSocketId(receiver);
//         if (receiverSocketId) {
//           io.to(receiverSocketId).emit("newMessage", message);
//         }
//       }
//     );

//     // Disconnect
//     socket.on("disconnect", () => {
//       console.log("❌ Disconnected:", userId, socket.id);
//       if (userId) {
//         delete users[userId];
//         io.emit("getOnlineUsers", Object.keys(users));
//       }
//     });
//   });
// };
