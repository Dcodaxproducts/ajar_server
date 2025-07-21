import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { Employee, IEmployee } from "../models/employeeManagement.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";


interface DecodedToken {
  id: string;
  role: string;
}

export const employeeAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      sendResponse(res, null, "Unauthorized: No token provided", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;

    if (decoded.role !== "staff") {
      sendResponse(res, null, "Unauthorized: Invalid role", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    const employee: IEmployee | null = await Employee.findById(decoded.id);
    if (!employee) {
      sendResponse(res, null, "Unauthorized: Employee not found", STATUS_CODES.UNAUTHORIZED);
      return;
    }

    // @ts-ignore: augmenting the Request interface
    req.employee = {
      id: (employee._id as string | { toString(): string }).toString(),
      roles: employee.roles,
    };

    next();
  } catch (error) {
    console.error("Auth error:", error);
    sendResponse(res, null, "Authentication failed", STATUS_CODES.UNAUTHORIZED);
  }
};
