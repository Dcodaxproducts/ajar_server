import { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { FRONTEND_URL, JWT_EXPIRES_IN, JWT_SECRET } from "../config/config";
import { IUser, User } from "../models/user.model";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID_NEXT);


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

    //match the same payload structure used in your login controller
    const payload = {
      id: user._id,       
      role: user.role,   
    };

    //identical signing method to your generateAccessToken
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: (JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) || "1d",
    });

    //redirect to frontend with valid token
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


export const nextAuthGoogleLogin: RequestHandler = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      res.status(400).json({ message: "idToken is required" });
      return;
    }

    // Verify the Google token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID_NEXT,
    });

    const googlePayload = ticket.getPayload();
    if (!googlePayload?.email) {
      res.status(401).json({ message: "Invalid Google token" });
      return;
    }

    // Find or create user
    let user = await User.findOne({ email: googlePayload.email });
    if (!user) {
      user = await User.create({
        email: googlePayload.email,
        name: googlePayload.name,
        profileImage: googlePayload.picture,
        authProvider: "google",
        password: crypto.randomBytes(32).toString("hex"),
        status : "active"
      });
    }

    if (!JWT_SECRET || typeof JWT_SECRET !== "string") {
      throw new Error("JWT_SECRET must be a defined string");
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: (JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "1d" }
    );

    res.json({ data: { token } });
  } catch (error: any) {
    console.error("NextAuth Google Login Error:", error);
    res.status(401).json({ message: "Google auth failed", error: error.message });
  }
};
