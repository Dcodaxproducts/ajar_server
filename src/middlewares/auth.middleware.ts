import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { verifyAccessToken } from "../utils/jwt.utils";
import { Employee } from "../models/employeeManagement.model";
import Role from "../models/employeeRole.model";

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

const methodToOperation: Record<string, string> = {
  POST: "create",
  GET: "read",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
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
    if (!decoded) {
      sendResponse(
        res,
        null,
        "Unauthorized: Invalid or expired token",
        STATUS_CODES.UNAUTHORIZED
      );
      return;
    }

    req.user = { id: decoded.id, role: decoded.role };

    // Skip RBAC for admin or any non-staff role
    if (decoded.role !== "staff") {
      return next();
    }

    // Fetch employee data
    const employee = await Employee.findById(decoded.id)
      .populate("allowAccess")
      .exec();

    if (!employee) {
      sendResponse(
        res,
        null,
        "Unauthorized: Employee not found",
        STATUS_CODES.UNAUTHORIZED
      );
      return;
    }

    // If no role assigned → deny
    if (!employee.allowAccess) {
      sendResponse(
        res,
        null,
        "Forbidden: No role assigned",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    const role = await Role.findById(employee.allowAccess);
    if (!role) {
      sendResponse(
        res,
        null,
        "Forbidden: Role not found",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    // Map HTTP method to operation
    const operation = methodToOperation[req.method];
    console.log({ operation });

    if (!operation) {
      sendResponse(
        res,
        null,
        "Operation not supported",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    // Dynamic permission check: match access substring & operation
    const hasPermission = role.permissions.some((perm) => {
      const urlMatches = req.originalUrl
        .toLowerCase()
        .includes(perm.access.toLowerCase());
      const opMatches = perm.operations.includes(operation);
      return urlMatches && opMatches;
    });

    if (!hasPermission) {
      sendResponse(
        res,
        null,
        "Forbidden: You do not have permission",
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    //  All checks passed
    next();
  } catch (err) {
    console.error(err);
    sendResponse(res, null, "Server error", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};
