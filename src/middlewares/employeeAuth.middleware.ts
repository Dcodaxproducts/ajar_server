import jwt, { JwtPayload } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { Employee } from "../models/employeeManagement.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

// Extend Request interface to add `employee`
import { Document } from "mongoose";
import { IEmployee } from "../models/employeeManagement.model";

export interface EmployeeAuthRequest extends Request {
  employee?: Document<unknown, {}, IEmployee> & IEmployee & Required<{ _id: unknown }>;
}

interface DecodedToken extends JwtPayload {
  id: string;
}

// Middleware for verifying employee token and role
export const employeeAuthMiddleware = (...allowedRoles: string[]) => {
  return async (req: EmployeeAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) {
        sendResponse(res, null, "Unauthorized: No token provided", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;
      if (!decoded?.id) {
        sendResponse(res, null, "Invalid token", STATUS_CODES.UNAUTHORIZED);
        return;
      }

      const employee = await Employee.findById(decoded.id);
      if (!employee) {
         sendResponse(res, null, "Unauthorized: Employee not found", STATUS_CODES.UNAUTHORIZED);
         return;
      }

      // Check if the employee has any allowed role
      const hasRole = allowedRoles.length === 0 || employee.staffRoles.some(role => allowedRoles.includes(role));
      if (!hasRole) {
        sendResponse(res, null, "Forbidden: Access denied", STATUS_CODES.FORBIDDEN);
        return;
      }

      req.employee = employee;
      next();
    } catch (error) {
      console.error("Auth error:", error);
      sendResponse(res, null, "Authentication failed", STATUS_CODES.UNAUTHORIZED);
    }
  };
};



// // middlewares/employeeAuth.middleware.ts
// import jwt, { JwtPayload } from "jsonwebtoken";
// import { Request, Response, NextFunction } from "express";
// import { Employee } from "../models/employeeManagement.model";
// import { sendResponse } from "../utils/response";
// import { STATUS_CODES } from "../config/constants";

// interface DecodedToken extends JwtPayload {
//   id: string;
// }

// export const employeeAuthMiddleware = (...allowedRoles: string[]) => {
//   return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//     try {
//       const token = req.headers.authorization?.split(" ")[1];
//       if (!token) {
//         sendResponse(res, null, "Unauthorized: No token provided", STATUS_CODES.UNAUTHORIZED);
//         return;
//       }

//       const decoded = jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;

//       if (!decoded?.id) {
//         sendResponse(res, null, "Invalid token payload", STATUS_CODES.UNAUTHORIZED);
//         return;
//       }

//       const employee = await Employee.findById(decoded.id);
//       if (!employee) {
//         sendResponse(res, null, "Unauthorized: Employee not found", STATUS_CODES.UNAUTHORIZED);
//         return;
//       }

//       // Check if employee has any of the allowed roles
//       if (allowedRoles.length > 0) {
//         const hasPermission = employee.roles.some(role => 
//           allowedRoles.includes(role)
//         );
        
//         if (!hasPermission) {
//           sendResponse(res, null, "Forbidden: Role not allowed", STATUS_CODES.FORBIDDEN);
//           return;
//         }
//       }

//       // @ts-ignore — augment req
//       req.employee = employee;
//       next();
//     } catch (err) {
//       console.error("Employee auth error:", err);
//       sendResponse(res, null, "Authentication failed", STATUS_CODES.UNAUTHORIZED);
//     }
//   };
// };