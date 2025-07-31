import express, { NextFunction } from "express";
import cors from "cors";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import morgan from "morgan";

import { globalRateLimiter } from "./middlewares/ratelimites.middleware";
import { redis } from "./utils/redis.client";


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

export default app;
