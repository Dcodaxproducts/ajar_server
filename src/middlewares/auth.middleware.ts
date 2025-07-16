import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { verifyAccessToken } from "../utils/jwt.utils";

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendResponse(
      res,
      null,
      "Unauthorized: No token provided",
      STATUS_CODES.UNAUTHORIZED
    );
    return;
  }

  const token = authHeader.split(" ")[1];
  const decoded = verifyAccessToken(token);

  console.log({ decoded });
  if (!decoded) {
    sendResponse(
      res,
      null,
      "Unauthorized: Invalid or expired token",
      STATUS_CODES.UNAUTHORIZED
    );
    return;
  }

  req.user = {
    id: decoded.id,
    role: decoded.role, 
  };

  next();
};


