import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model";
import { RequestHandler } from "express";

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export const verifyActiveUser: RequestHandler = async (req: any, res, next) => {
  try {
    if (!req.user || !req.user.id) return next();

    const user = await User.findById(req.user.id);

    if (user?.status === "blocked") {
      res.status(403).json({
        message: "Your account has been blocked.",
        code: "USER_BLOCKED",
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};