import { RequestHandler } from "express";
import { verifyAccessToken } from "../utils/jwt.utils";

export interface AuthRequest extends Express.Request {
  user?: {
    id: string;
    role: string;
  };
}

export const optionalAuth: RequestHandler = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) return next();

    // 👇 type cast ONLY here
    (req as AuthRequest).user = {
      id: decoded.id,
      role: decoded.role,
    };

    next();
  } catch {
    next();
  }
};


// import { Request, Response, NextFunction } from "express";
// import { verifyAccessToken } from "../utils/jwt.utils";
// import { Employee } from "../models/employeeManagement.model";
// import Role from "../models/employeeRole.model";

// export interface AuthRequest extends Request {
//   user?: { id: string; role: string };
// }

// export const optionalAuth = async (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const authHeader = req.headers.authorization;

//     // No token → continue as guest
//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//       return next();
//     }

//     const token = authHeader.split(" ")[1];
//     const decoded = verifyAccessToken(token);

//     if (!decoded) {
//       // Invalid token → treat as guest (skip sending Unauthorized)
//       return next();
//     }

//     req.user = { id: decoded.id, role: decoded.role };

//     //For staff, you can still do RBAC like your `authMiddleware`
//     if (decoded.role === "staff") {
//       const employee = await Employee.findById(decoded.id)
//         .populate("allowAccess")
//         .exec();

//       if (employee && employee.allowAccess) {
//         const role = await Role.findById(employee.allowAccess);
//         if (role) {
//           req.user.role = decoded.role; // still mark as staff
//         }
//       }
//     }

//     next();
//   } catch (err) {
//     console.error(err);
//     // Don’t block guest → just continue
//     next();
//   }
// };
