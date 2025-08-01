import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { Chat } from "../models/chat.model"; 
import { config } from "../config/env"; 

const JWT_SECRET = config.JWT_SECRET || "your_default_jwt_secret";

//Define JWT payload interface
interface JwtPayload {
  id: string;
  role: string;
}

//Define incoming message format
interface MessageData {
  message: string;
  roomId: string;
  receiverId: string;
}

export const setupChatSocket = (io: Server) => {
  //Authenticate each socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized: No token"));

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      socket.data.user = decoded; // Attach user to socket
      next();
    } catch (err) {
      next(new Error("Unauthorized: Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.user.id;
    console.log("Socket connected:", userId, socket.id);

    //Join a room for private 1-to-1 or group chats
    socket.on("joinRoom", (roomId: string) => {
      socket.join(roomId);
      console.log(`User ${userId} joined room ${roomId}`);
    });

    //Handle sending and saving chat messages
    socket.on("sendMessage", async (data: MessageData) => {
      const { roomId, message, receiverId } = data;

      const chat = await Chat.create({
        senderId: userId,
        receiverId,
        message,
        roomId,
      });

      const payload = {
        senderId: userId,
        receiverId,
        roomId,
        message,
        createdAt: chat.createdAt,
      };

      //Send message to users in the room
      io.to(roomId).emit("receiveMessage", payload);

      //Send user-to-user notification (if needed)
      io.to(roomId).emit("newMessageNotification", {
        from: userId,
        roomId,
        message: "New message received",
      });
    });

    socket.on("disconnect", () => {
      console.log(`Disconnected socket: ${userId}`);
    });
  });
};
