import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";

// When a role is allowed, its mapped roles are also auto-allowed
const SUPER_ROLES: Record<string, string[]> = {
  admin: ["staff"],
};

export const allowRoles = (roles: string | string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        sendResponse(
          res,
          null,
          "Unauthorized: User not authenticated",
          STATUS_CODES.UNAUTHORIZED
        );
        return;
      }

      const allowedRoles = Array.isArray(roles) ? roles : [roles];
      const allAllowedRoles = [
        ...new Set([
          ...allowedRoles,
          ...allowedRoles.flatMap((role) => SUPER_ROLES[role] ?? []),
        ]),
      ];

      if (!allAllowedRoles.includes(req.user.role)) {
        sendResponse(
          res,
          null,
          `Forbidden: Role '${req.user.role}' is not allowed`,
          STATUS_CODES.FORBIDDEN
        );
        return;
      }

      next();
    } catch (error) {
      console.error(error);
      sendResponse(
        res,
        null,
        "Server error",
        STATUS_CODES.INTERNAL_SERVER_ERROR
      );
    }
  };
};