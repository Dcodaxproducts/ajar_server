import dotenv from "dotenv";

dotenv.config();

export const config = {
  PORT: process.env.PORT || "5005",
  JWT_SECRET: process.env.JWT_SECRET,
  MONGO_URI: process.env.MONGO_URI,
  ACCESS_TOKEN_SECRET: "your_access_secret_key",
  REFRESH_TOKEN_SECRET: "your_refresh_secret_key",
  ACCESS_TOKEN_EXPIRATION: "7d",
  REFRESH_TOKEN_EXPIRATION: "30d",
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
};

