import { Request, Response, NextFunction } from "express";
import { Document } from "mongoose";
import { Employee, IEmployee } from "../models/employeeManagement.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { verifyAccessToken } from "../utils/jwt.utils";


export interface EmployeeAuthRequest extends Request {
  employee?: Document<unknown, {}, IEmployee> & IEmployee & Required<{ _id: unknown }>;
}

export const employeeAuthMiddleware = (
  ...args: [string, "create" | "read" | "update" | "delete"] | string[]
) => {
  return async (
    req: EmployeeAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        sendResponse(res, null, "Unauthorized: No token provided", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      const token = authHeader.split(" ")[1];
      const decoded = verifyAccessToken(token);

      if (!decoded?.id) {
        sendResponse(res, null, "Invalid token", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      const employee = await Employee.findById(decoded.id)
        .populate("allowAccess")
        .lean();

      if (!employee) {
        sendResponse(res, null, "Unauthorized: Employee not found", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      const role = employee.allowAccess as any;
      const permissions = role?.permissions || [];

      // CASE 1: If only 2 arguments passed, treat as [access, operation]
      if (args.length === 2) {
        const [access, operation] = args as [string, "create" | "read" | "update" | "delete"];
        const hasPermission = permissions.some(
          (perm: any) => perm.access === access && perm.operations?.includes(operation)
        );

        if (!hasPermission) {
          sendResponse(
            res,
            null,
            `Access denied: You do not have permission to [${operation}] [${access}]`,
            STATUS_CODES.FORBIDDEN
          );
          return;
        }
      }

      // CASE 2: If 3 or more arguments, treat all as access modules for "read"
      else if (args.length >= 3) {
        const accessModules = args as string[]; // These are ["zone", "categories", "field"]
        const hasAtLeastOne = accessModules.some((access) =>
          permissions.find(
            (perm: any) => perm.access === access && perm.operations?.includes("read")
          )
        );

        if (!hasAtLeastOne) {
          sendResponse(
            res,
            null,
            `Access denied: You do not have 'read' access to any of: ${accessModules.join(", ")}`,
            STATUS_CODES.FORBIDDEN
          );
          return;
        }
      }

      // Attach to request for downstream use
      req.employee = employee as any;
      next();
    } catch (error) {
      console.error("Auth Middleware Error:", error);
      sendResponse(res, null, "Authentication failed", STATUS_CODES.UNAUTHORIZED);
    }
  };
};
