import { Server as SocketIOServer, Socket } from "socket.io";
import { allowedOrigins } from "../config/corsOrigins";
import { authMiddleware } from "./auth";
import registerMessageEvents from "./events/message";

export interface UserSocketHelpers {
  getUserSockets: (uid: string) => string[];
  isUserOnline: (uid: string) => boolean;
  getIO: () => SocketIOServer;
}

const users = new Map<string, Set<string>>();
const userStatus = new Map<string, boolean>(); // Track online status

let io: SocketIOServer;

export const initSocket = (server: any) => {
  io = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use(authMiddleware);

  io.on("connection", (socket: Socket) => {
    const userId = (socket as any).userId;

    console.log(`User ${userId} connected with socket ${socket.id}`);

    socket.join(`user:${userId}`);
    socket.join(`chat:status:${userId}`); // Room for status updates

    if (!users.has(userId)) users.set(userId, new Set());
    users.get(userId)!.add(socket.id);

    // Mark user as online if first connection
    
   const wasOnline = users.get(userId)!.size > 0;
    if (!wasOnline) {
      userStatus.set(userId, true);
      io.emit("user:online", userId);

      // When user comes online, mark all their undelivered messages as delivered
      socket.emit("user:online:sync");
    }

    registerMessageEvents(io, socket, userId, {
      getUserSockets: (uid: string) => Array.from(users.get(uid) || []),
      isUserOnline: (uid: string) => users.has(uid) && users.get(uid)!.size > 0,
      getIO: () => io,
    });

    socket.on("disconnect", (reason) => {
      const sockets = users.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          users.delete(userId);
          userStatus.set(userId, false);
          io.emit("user:offline", userId);
        }
      }
      console.log(
        `User ${userId} disconnected socket ${socket.id}, reason: ${reason}`
      );
    });

    socket.on("error", (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });

  return io;
};


export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

export const isUserOnline = (userId: string): boolean => {
  return userStatus.get(userId) || false;
};
