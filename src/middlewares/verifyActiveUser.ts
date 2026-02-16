import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model";
import { RequestHandler } from "express";

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}


export const verifyActiveUser: RequestHandler = async (req: any, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next();
    }

    const user = await User.findById(req.user.id);

    if (user?.status === "blocked" || user?.status === "inactive") {
      res.status(403).json({
        message: user?.status === "blocked"
          ? "Your account has been blocked."
          : "Your account is currently inactive. Please contact support.",
        code: user?.status === "blocked" ? "USER_BLOCKED" : "USER_INACTIVE"
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};