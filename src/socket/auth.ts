import { Socket } from "socket.io";
import jwt, { JwtPayload } from "jsonwebtoken";
import { config } from "../config/env";

const JWT_SECRET = config.ACCESS_TOKEN_SECRET as string;

export function authMiddleware(socket: Socket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token;
  // if (!token) return next(new Error("Unauthorized"));
  if (!token) {
    console.log("Socket auth failed: No token");
    return next(new Error("Unauthorized"));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & {
      id?: string;
    };
    // if (!decoded.id) return next(new Error("Unauthorized"));
     if (!decoded.id) {
      console.log("Socket auth failed: Invalid token");
      return next(new Error("Unauthorized"));
    }

    // Attach userId to socket
    (socket as any).userId = decoded.id;
    next();
  } catch(err) {
    console.log("Socket auth failed:", err);
    next(new Error("Unauthorized"));
  }
}
