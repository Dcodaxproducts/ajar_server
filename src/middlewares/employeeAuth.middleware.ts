import { Request, Response, NextFunction } from "express";
import { Document } from "mongoose";
import { Employee, IEmployee } from "../models/employeeManagement.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { verifyAccessToken } from "../utils/jwt.utils";

// // Extend Request interface
// export interface EmployeeAuthRequest extends Request {
//   employee?: Document<unknown, {}, IEmployee> & IEmployee & Required<{ _id: unknown }>;
// }

// export const employeeAuthMiddleware = (...allowedRoles: string[]) => {
//   return async (req: EmployeeAuthRequest, res: Response, next: NextFunction): Promise<void> => {
//     try {
//       const authHeader = req.headers.authorization;
//       if (!authHeader || !authHeader.startsWith("Bearer ")) {
//         console.warn("No token provided in request headers");
//         sendResponse(res, null, "Unauthorized: No token provided", STATUS_CODES.UNAUTHORIZED);
//         return;
//       }

//       const token = authHeader.split(" ")[1];
//       const decoded = verifyAccessToken(token);
//       console.log("Decoded token:", decoded);

//       if (!decoded?.id) {
//         console.warn("Decoded token missing 'id'");
//         sendResponse(res, null, "Invalid token", STATUS_CODES.UNAUTHORIZED);
//         return;
//       }

//       const employee = await Employee.findById(decoded.id);
//       console.log("Fetched employee:", employee?.email || "Not Found");

//       if (!employee) {
//         console.warn("Employee not found for ID:", decoded.id);
//         sendResponse(res, null, "Unauthorized: Employee not found", STATUS_CODES.UNAUTHORIZED);
//         return;
//       }

//       const hasRole =
//         allowedRoles.length === 0 || employee.allowAccess .some(role => allowedRoles.includes(role.toString()));
//         // allowedRoles.length === 0 || employee.allowAccess .some(role => allowedRoles.includes(role));
//       console.log("Employee roles:", employee.allowAccess , "Allowed roles:", allowedRoles, "Access granted:", hasRole);

//       if (!hasRole) {
//         console.warn(`Access denied. Role(s) not allowed: [${employee.allowAccess .join(", ")}]`);
//         sendResponse(
//           res,
//           null,
//           `Your role(s) [${employee.allowAccess .join(", ")}] are not allowed to access this resource.`,
//           STATUS_CODES.FORBIDDEN
//         );
//         return;
//       }

//       req.employee = employee;
//       console.log("Authentication successful for employee:", employee.email);
//       next();
//     } catch (error) {
//       console.error("Employee authentication error:", error);
//       sendResponse(res, null, "Authentication failed", STATUS_CODES.UNAUTHORIZED);
//     }
//   };
// };
export interface EmployeeAuthRequest extends Request {
  employee?: Document<unknown, {}, IEmployee> & IEmployee & Required<{ _id: unknown }>;
}

export const employeeAuthMiddleware = (...allowedRoles: string[]) => {
  return async (req: EmployeeAuthRequest, res: Response, next: NextFunction): Promise<void> => {
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

      const employee = await Employee.findById(decoded.id).populate("allowAccess"); // ✅ populate allowAccess
      if (!employee) {
        sendResponse(res, null, "Unauthorized: Employee not found", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      // ✅ allowAccess check (string match with role name)
      const roleName = (employee.allowAccess as any)?.name;
      const hasRole = allowedRoles.length === 0 || allowedRoles.includes(roleName);

      if (!hasRole) {
        sendResponse(
          res,
          null,
          `Your role [${roleName}] is not allowed to access this resource.`,
          STATUS_CODES.FORBIDDEN
        );
        return;
      }

      req.employee = employee;
      next();
    } catch (error) {
      sendResponse(res, null, "Authentication failed", STATUS_CODES.UNAUTHORIZED);
    }
  };
};
