import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../config/constants";
import { sendResponse } from "../utils/response";
import { verifyAccessToken } from "../utils/jwt.utils";
import { Employee } from "../models/employeeManagement.model";
import Role from "../models/employeeRole.model";
import { endpointAccessMap } from "../config/accessControl";

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
        req.t("access:noToken"),
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
        req.t("access:invalidOrExpiredToken"),
        STATUS_CODES.UNAUTHORIZED
      );
      return;
    }

    req.user = { id: decoded.id, role: decoded.role };

    // Admin bypass
    if (decoded.role !== "staff") return next();

    // Get employee with role
    const employee = await Employee.findById(decoded.id)
      .populate("allowAccess")
      .exec();

    if (!employee || !employee.allowAccess) {
      sendResponse(
        res,
        null,
        req.t("access:noRoleAssigned"),
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    const role = await Role.findById(employee.allowAccess).lean();
    if (!role) {
      sendResponse(
        res,
        null,
        req.t("access:roleNotFound"),
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    // Determine required access key
    const baseUrl = req.baseUrl.replace(/^\/api/, "");
    const accessKey =
      endpointAccessMap[baseUrl as keyof typeof endpointAccessMap];

    // If endpoint is not in the access map, allow access
    if (!accessKey) {
      return next();
    }

    // Determine operation (create/read/update/delete)
    const operation = methodToOperation[req.method];
    if (!operation) {
      sendResponse(
        res,
        null,
        req.t("access:operationNotSupported"),
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    // Check permissions only for mapped endpoints
    const hasPermission = role.permissions.some(
      (perm) => perm.access === accessKey && perm.operations.includes(operation)
    );

    if (!hasPermission) {
      sendResponse(
        res,
        null,
        req.t("access:noPermission", {
          operation: operation.toUpperCase(),
          access: accessKey,
        }),
        STATUS_CODES.FORBIDDEN
      );
      return;
    }

    // Permission granted
    next();
  } catch (err) {
    console.error(err);
    sendResponse(res, null, req.t("common:serverError"), STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};
