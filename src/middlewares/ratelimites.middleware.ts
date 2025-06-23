import rateLimit from "express-rate-limit";
import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip || "",
  handler: (req: Request, res: Response, next: NextFunction) => {
    sendResponse(
      res,
      null,
      "Too many requests from this IP, please try again later.",
      STATUS_CODES.TOO_MANY_REQUESTS
    );
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later.",
  keyGenerator: (req: Request) => req.body.email || req.ip,
});
