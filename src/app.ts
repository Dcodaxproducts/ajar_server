import cors from "cors";
import express, { Application, Request, Response } from "express";
import http, { Server as HTTPServer } from "http";
import morgan from "morgan";
import path from "path";
import { allowedOrigins } from "./config/corsOrigins";
import { errorHandler } from "./middlewares/errorHandler";
import routes from "./routes";
import "./config/passport";
import compression from "compression";
import passport from "passport";
import { stripeWebhook } from "./controllers/payment.controller";

export const app = express();
export const server = http.createServer(app);

app.use(compression());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Add BEFORE app.use(express.json(...))
app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook as express.RequestHandler
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

app.use(passport.initialize());

// API routes
app.use("/api", routes);

// Root
app.get("/", (req: Request, res: Response) => {
  console.log(`HTTP Version: ${req.httpVersion}`);
  res.send("Server with Google OAuth + MongoDB + JWT is running...");
});

// Root
app.get("/", (req: Request, res: Response) => {
  console.log(`HTTP Version: ${req.httpVersion}`);
  res.send("server is running .... ");
});

// Error handler
app.use(errorHandler);
