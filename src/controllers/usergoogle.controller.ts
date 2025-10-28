import { Request, Response, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { FRONTEND_URL, JWT_EXPIRES_IN, JWT_SECRET } from "../config/config";
import { IUser } from "../models/user.model";

export const googleCallback: RequestHandler = async (req, res) => {
  try {
    const user = req.user as IUser;

    if (!user) {
      res.status(401).json({ message: "Authentication failed" });
      return;
    }

    if (!JWT_SECRET || typeof JWT_SECRET !== "string") {
      throw new Error("JWT_SECRET must be a defined string");
    }

    // 👇 Explicitly cast options to jwt.SignOptions
    const token = jwt.sign(
      { sub: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: (JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "1d" }
    );

    const redirectUrl = `${FRONTEND_URL}/auth-success?token=${token}`;
    res.redirect(redirectUrl);
  } catch (error: any) {
    console.error("Google Callback Error:", error);
    res.status(500).json({ message: "OAuth callback failed", error: error.message });
  }
};

export const verifyToken: RequestHandler = (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing or invalid token" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    if (!JWT_SECRET || typeof JWT_SECRET !== "string") {
      throw new Error("JWT_SECRET must be a defined string");
    }

    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok: true, payload });
  } catch (err: any) {
    res.status(401).json({ message: "Token expired or invalid", error: err.message });
  }
};
