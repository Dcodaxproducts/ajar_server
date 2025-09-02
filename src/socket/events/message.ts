import { Server, Socket } from "socket.io";
import mongoose from "mongoose";
import { Message } from "../../models/message.model";
import { UserSocketHelpers } from "..";

/**
 * Registers message-related socket events for a connected user
 */
export default function registerMessageEvents(
  io: Server,
  socket: Socket,
  userId: string,
  helpers: UserSocketHelpers
) {
  const { getUserSockets } = helpers;
  // On connect → bulk mark undelivered messages as delivered
  Message.updateMany(
    {
      receiver: new mongoose.Types.ObjectId(userId),
      deliveredAt: { $exists: false },
    },
    { $set: { deliveredAt: new Date() } }
  ).catch((err) => console.error("Error updating bulk delivery:", err));

  /**
   * Delivered receipts (batch)
   * Payload: { chatId, messageIds: string[] }
   */
  socket.on(
    "message:delivered",
    async ({
      chatId,
      messageIds,
    }: {
      chatId: string;
      messageIds: string[];
    }) => {
      try {
        if (!messageIds?.length) return;

        const now = new Date();
        const result = await Message.updateMany(
          {
            _id: {
              $in: messageIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
            receiver: userId,
            deliveredAt: { $exists: false },
          },
          { $set: { deliveredAt: now } }
        );

        if (result.modifiedCount > 0) {
          // Notify sender(s)
          const messages = await Message.find({ _id: { $in: messageIds } });
          const senderIds = [
            ...new Set(messages.map((m) => m.sender.toString())),
          ];

          senderIds.forEach((sid) => {
            const senderSocketIds = getUserSockets(sid);
            senderSocketIds.forEach((socketId) => {
              io.to(socketId).emit("message:delivered", {
                chatId,
                messageIds,
                deliveredAt: now,
              });
            });
          });
        }
      } catch (err) {
        console.error("Error updating delivery status:", err);
      }
    }
  );

  /**
   * Read receipts (batch)
   * Payload: { chatId, messageIds: string[] }
   */
  socket.on(
    "message:read",
    async ({
      chatId,
      messageIds,
    }: {
      chatId: string;
      messageIds: string[];
    }) => {
      try {
        if (!messageIds?.length) return;

        const now = new Date();
        const result = await Message.updateMany(
          {
            _id: {
              $in: messageIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
            receiver: userId,
            readAt: { $exists: false },
          },
          { $set: { readAt: now } }
        );

        if (result.modifiedCount > 0) {
          // Notify sender(s)
          const messages = await Message.find({ _id: { $in: messageIds } });
          const senderIds = [
            ...new Set(messages.map((m) => m.sender.toString())),
          ];

          senderIds.forEach((sid) => {
            const sockets = getUserSockets(sid);
            sockets.forEach((socketId) => {
              io.to(socketId).emit("message:read", {
                chatId,
                messageIds,
                readAt: now,
              });
            });
          });
        }
      } catch (error) {
        console.error("Error updating message read status:", error);
      }
    }
  );
}
