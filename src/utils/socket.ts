import { Server as SocketIOServer } from "socket.io";
import jwt, { JwtPayload } from "jsonwebtoken";
import { allowedOrigins } from "../config/corsOrigins";
import { config } from "../config/env";

const JWT_SECRET = config.ACCESS_TOKEN_SECRET as string;

// Users map
type Users = { [key: string]: string };
const users: Users = {};

let io: SocketIOServer; // not initialized immediately

export const initSocket = (server: any) => {
  io = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("New socket connection:", socket.id);

    const token = socket.handshake.query.token;
    if (!token) {
      socket.disconnect();
      return;
    }

    try {
      const decoded = jwt.verify(token as string, JWT_SECRET) as JwtPayload & {
        id: string;
      };
      const userId = decoded.id;

      console.log("User ID from token:", userId);

      users[userId] = socket.id;
      io.emit("getOnlineUsers", Object.keys(users));

      socket.on("disconnect", () => {
        delete users[userId];
        io.emit("getOnlineUsers", Object.keys(users));
      });
    } catch {
      socket.disconnect();
    }
  });

  return io;
};

// ✅ getter for io (safe to use after initSocket is called in server.ts)
export const getIO = () => {
  if (!io)
    throw new Error(
      "Socket.io not initialized! Call initSocket(server) first."
    );
  return io;
};

export const getReceiverSocketId = (receiverId: string) => {
  console.log({ users });
  return users[receiverId];
};
