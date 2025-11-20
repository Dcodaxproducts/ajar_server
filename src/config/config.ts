import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 5000;
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

export const JWT_SECRET = process.env.JWT_SECRET || "secret";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
export const TWOFA_ENC_KEY = process.env.TWOFA_ENC_KEY || "";