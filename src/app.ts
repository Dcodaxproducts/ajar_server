import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { Server } from "socket.io";

import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { globalRateLimiter } from "./middlewares/ratelimites.middleware";
import { setupChatSocket } from "./utils/chat.socket";

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://192.168.18.89:3000"],
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));
app.use(morgan("dev"));
app.use(globalRateLimiter);
app.use("/api", routes);

app.get("/", (req, res) => {
  console.log(`HTTP Version: ${req.httpVersion}`);
  res.send("server is running .... ");
});

app.use(errorHandler);

//Create and export HTTP + Socket.IO server
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://192.168.18.89:3000"],
    credentials: true,
  },
});

setupChatSocket(io);

export { server };
