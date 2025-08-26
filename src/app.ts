import express, { Application, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import http, { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { globalRateLimiter } from "./middlewares/ratelimites.middleware";
import jwt, { JwtPayload } from "jsonwebtoken";
import { allowedOrigins } from "./config/corsOrigins";
import { config } from "./config/env";
// import { setupChatSocket } from "./utils/socket";

const app: Application = express();

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));
app.use(morgan("dev"));
// app.use(globalRateLimiter);

// Static uploads route
app.get("/uploads/:filename", (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, "../public/uploads", filename);

  res.setHeader("Cache-Control", "public, max-age=31536000");

  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(404).send("File not found");
    }
  });
});

// API routes
app.use("/api", routes);

// Root
app.get("/", (req: Request, res: Response) => {
  console.log(`HTTP Version: ${req.httpVersion}`);
  res.send("server is running .... ");
});

// Error handler
app.use(errorHandler);

// Create HTTP server
const server: HTTPServer = http.createServer(app);

// Create Socket.IO server
const io: SocketIOServer = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  // transports: ["websocket", "polling"],
});

// Attach socket events
// setupChatSocket(io);

const JWT_SECRET: string = config.ACCESS_TOKEN_SECRET as string;

type Users = {
  [key: string]: string;
};
const users: Users = {};
export const getReceiverSocketId = (receiverId: string) => {
  return users[receiverId];
};

io.on("connection", (socket) => {
  console.log("New socket connection:", socket.id);
  const token = socket.handshake.query.token;
  console.log("Socket token:", token);
  console.log(users);

  if (!token) {
    console.log("No token provided. Disconnecting socket.");
    socket.disconnect();
    return;
  }
  let userId;
  try {
    const decoded = jwt.verify(token as string, JWT_SECRET) as JwtPayload & {
      id: string;
    };
    // console.log(decoded);
    userId = decoded.id;
  } catch (err) {
    // console.log(err);

    console.log("Invalid token. Disconnecting socket.");
    socket.disconnect();
    return;
  }

  if (userId) {
    users[userId] = socket.id;
    console.log(users);

    io.emit("getOnlineUsers", Object.keys(users));
  } else {
    console.log("No userId found in token. Disconnecting socket.");
    socket.disconnect();
  }
  //  socket.on("messageRead", async (messageId) => {
  //     console.log("messageRead event received for:", messageId);
  //     try {
  //      const  message = await Message.findById(messageId);
  //       if (message && !message.read && message.receiver.toString() === userId) {
  //         await Message.findByIdAndUpdate(messageId, { read: true });
  //         console.log(Message ${messageId} marked as read);

  //     const senderSocketId = getReceiverSocketId(message.sender.toString());
  //     if (senderSocketId) {
  //       io.emit("messageReadStatusUpdated", {
  //         messageId,
  //       });
  //     }
  //   }
  // } catch (error) {
  //   console.error("Error updating message read status:", error);
  // }
  //   });

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    if (userId) {
      delete users[userId];
      io.emit("getOnlineUsers", Object.keys(users));
    }
  });
});

export { app, server, io };
