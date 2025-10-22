import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import dotenv from "dotenv";
import { config } from "../config/env";

dotenv.config();

const ACCESS_SECRET = config.ACCESS_TOKEN_SECRET as jwt.Secret;
const REFRESH_SECRET = config.REFRESH_TOKEN_SECRET as jwt.Secret;
const ACCESS_EXPIRATION: string = config.ACCESS_TOKEN_EXPIRATION || "15m";
const REFRESH_EXPIRATION: string = config.REFRESH_TOKEN_EXPIRATION || "7d";

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error("JWT Secrets are not defined in environment variables");
}

//Generate an Access Token (Short lifespan)

export const generateAccessToken = (payload: object): string => {
  const signOptions: SignOptions = {
    expiresIn: ACCESS_EXPIRATION as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, ACCESS_SECRET, signOptions);
};

//Generate a Refresh Token (Long lifespan)

export const generateRefreshToken = (
  payload: object,
  expiry: string
): string => {
  const signOptions: SignOptions = {
    expiresIn: (expiry || REFRESH_EXPIRATION) as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, REFRESH_SECRET, signOptions);
};

export const verifyAccessToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
  } catch (error) {
    return null; // Token is invalid or expired
  }
};

export const verifyRefreshToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
  } catch (error) {
    return null;
  }
};

//create function to generate token ( generateResetToken )

export const generateResetToken = (payload: object): string => {
  const signOptions: SignOptions = {
    expiresIn: "1h",
  };
  return jwt.sign(payload, ACCESS_SECRET, signOptions);
};
