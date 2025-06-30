import { Request } from "express";

export const getLanguage = (req: Request): string => {
  return req.headers["language"]?.toString() || "en";
};
