import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model";
import { RequestHandler } from "express";
import { Employee } from "../models/employeeManagement.model";

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export const verifyActiveUser: RequestHandler = async (req: any, res, next) => {
  try {
    if (!req.user || !req.user.id || !req.user.role) return next();

    if (req.user.role === "user") {
      const user = await User.findById(req.user.id);

      if (user?.status === "blocked") {
        res.status(403).json({
          message: "Your account has been blocked.",
          code: "USER_BLOCKED",
        });
        return;
      }
    }
    else {
      const user = await Employee.findById(req.user.id);

      if (user?.status === "blocked") {
        res.status(403).json({
          message: "Your account has been blocked.",
          code: "EMPLOYEE_BLOCKED",
        });
        return;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};